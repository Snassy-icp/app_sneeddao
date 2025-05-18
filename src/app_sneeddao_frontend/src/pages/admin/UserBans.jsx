import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../AuthContext';
import { useAdminCheck } from '../../hooks/useAdminCheck';
import { createActor as createBackendActor, canisterId as backendCanisterId } from 'declarations/app_sneeddao_backend';
import Header from '../../components/Header';
import { Principal } from '@dfinity/principal';

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
  const [expandedUser, setExpandedUser] = useState(null);
  const [banHistory, setBanHistory] = useState([]);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [duration, setDuration] = useState('');
  const [durationUnit, setDurationUnit] = useState('hours');
  const [reason, setReason] = useState('');

  // Use admin check hook
  useAdminCheck({ identity, isAuthenticated });

  useEffect(() => {
    if (isAuthenticated) {
      fetchBans();
    }
  }, [isAuthenticated]);

  // Helper function to format expiry timestamp
  const formatExpiry = (expiry) => {
    try {
      // Convert nanoseconds to milliseconds if the number is too large
      const timestamp = expiry > 1e12 ? Math.floor(expiry / 1e6) : expiry * 1000;
      const date = new Date(timestamp);
      
      // Check if the date is valid
      if (isNaN(date.getTime())) {
        return 'Invalid Date';
      }
      
      return date.toLocaleString();
    } catch (err) {
      console.error('Error formatting expiry:', err);
      return 'Invalid Date';
    }
  };

  // Helper function to convert duration to hours based on unit
  const convertToHours = (value, unit) => {
    const numValue = Number(value);
    switch (unit) {
      case 'hours':
        return numValue;
      case 'days':
        return numValue * 24;
      case 'weeks':
        return numValue * 24 * 7;
      case 'months':
        return numValue * 24 * 30;
      case 'years':
        return numValue * 24 * 365;
      default:
        return numValue;
    }
  };

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
      console.log('Bans response:', result);
      
      if ('ok' in result) {
        // Convert the entries to an array if it's not already
        const bansArray = Array.isArray(result.ok) ? result.ok : Object.entries(result.ok);
        // Convert Principal objects to strings and format expiry
        const formattedBans = bansArray.map(([principal, expiry]) => ({
          principal: principal.toString(),
          expiry: Number(expiry)
        }));
        setBannedUsers(formattedBans);
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

  const fetchBanHistory = async (principal) => {
    if (!identity) return;

    setLoadingHistory(true);
    try {
      const backendActor = createBackendActor(backendCanisterId, {
        agentOptions: {
          identity,
          host: process.env.DFX_NETWORK === 'ic' ? 'https://icp0.io' : 'http://localhost:4943',
        }
      });
      
      // Convert the principal string to a Principal object
      const principalObj = Principal.fromText(principal);
      const result = await backendActor.get_user_ban_history(principalObj);
      
      if ('ok' in result) {
        setBanHistory(result.ok);
        setError('');
      } else {
        setError(result.err);
      }
    } catch (err) {
      console.error('Error fetching ban history:', err);
      setError('Failed to fetch ban history');
    } finally {
      setLoadingHistory(false);
    }
  };

  const handleRowClick = async (principal) => {
    if (expandedUser === principal) {
      setExpandedUser(null);
      setBanHistory([]);
    } else {
      setExpandedUser(principal);
      await fetchBanHistory(principal);
    }
  };

  const handleBanUser = async (e) => {
    e.preventDefault();
    if (!duration || !reason) return;

    try {
      const durationInHours = convertToHours(duration, durationUnit);
      const backendActor = createBackendActor(backendCanisterId, {
        agentOptions: {
          identity,
          host: process.env.DFX_NETWORK === 'ic' ? 'https://icp0.io' : 'http://localhost:4943',
        }
      });
      const result = await backendActor.ban_user(Principal.fromText(e.target.principal.value), durationInHours, reason);
      if ('ok' in result) {
        setDuration('');
        setReason('');
        await fetchBans();
      } else {
        setError(result.err);
      }
    } catch (err) {
      console.error('Error banning user:', err);
      setError('Failed to ban user');
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
        <h1 style={{ color: '#ffffff', marginBottom: '20px' }}>User Bans</h1>

        {error && (
          <div style={{ 
            backgroundColor: 'rgba(231, 76, 60, 0.2)', 
            border: '1px solid #e74c3c',
            color: '#e74c3c',
            padding: '15px',
            borderRadius: '6px',
            marginBottom: '20px'
          }}>
            {error}
          </div>
        )}

        <div style={{ 
          backgroundColor: '#2a2a2a',
          borderRadius: '8px',
          padding: '20px',
          marginBottom: '20px'
        }}>
          <form onSubmit={handleBanUser} style={{ 
            display: 'flex',
            flexDirection: 'column',
            gap: '15px',
            marginBottom: '20px'
          }}>
            <div>
              <input
                type="text"
                name="principal"
                placeholder="User Principal ID"
                style={{
                  width: '100%',
                  backgroundColor: '#3a3a3a',
                  border: '1px solid #4a4a4a',
                  borderRadius: '4px',
                  color: '#ffffff',
                  padding: '8px 12px'
                }}
              />
            </div>
            <div style={{ marginBottom: '10px', display: 'flex', alignItems: 'center', gap: '10px' }}>
              <input
                type="number"
                value={duration}
                onChange={(e) => setDuration(e.target.value)}
                placeholder="Duration"
                min="1"
                style={{
                  padding: '8px',
                  width: '100px'
                }}
              />
              <select
                value={durationUnit}
                onChange={(e) => setDurationUnit(e.target.value)}
                style={{
                  padding: '8px',
                  backgroundColor: '#fff',
                  border: '1px solid #ccc',
                  borderRadius: '4px'
                }}
              >
                <option value="hours">Hours</option>
                <option value="days">Days</option>
                <option value="weeks">Weeks</option>
                <option value="months">Months</option>
                <option value="years">Years</option>
              </select>
            </div>
            <div>
              <input
                type="text"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Reason for ban"
                style={{
                  width: '100%',
                  backgroundColor: '#3a3a3a',
                  border: '1px solid #4a4a4a',
                  borderRadius: '4px',
                  color: '#ffffff',
                  padding: '8px 12px'
                }}
              />
            </div>
            <button
              type="submit"
              disabled={!duration || !reason}
              style={{
                backgroundColor: '#3498db',
                color: '#ffffff',
                border: 'none',
                borderRadius: '4px',
                padding: '8px 16px',
                cursor: duration && reason ? 'pointer' : 'not-allowed',
                opacity: duration && reason ? 1 : 0.7
              }}
            >
              Ban User
            </button>
          </form>

          {loading ? (
            <div style={{ textAlign: 'center', padding: '20px', color: '#ffffff' }}>
              Loading...
            </div>
          ) : bannedUsers.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '20px', color: '#888' }}>
              No users are currently banned.
            </div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={{ 
                    color: '#ffffff',
                    textAlign: 'left',
                    padding: '12px 8px',
                    borderBottom: '1px solid #4a4a4a'
                  }}>
                    Principal ID
                  </th>
                  <th style={{ 
                    color: '#ffffff',
                    textAlign: 'left',
                    padding: '12px 8px',
                    borderBottom: '1px solid #4a4a4a'
                  }}>
                    Expiry
                  </th>
                  <th style={{ 
                    color: '#ffffff',
                    textAlign: 'right',
                    padding: '12px 8px',
                    borderBottom: '1px solid #4a4a4a'
                  }}>
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody>
                {bannedUsers.map((ban, index) => (
                  <React.Fragment key={index}>
                    <tr 
                      onClick={() => handleRowClick(ban.principal)}
                      style={{
                        backgroundColor: index % 2 === 0 ? '#2a2a2a' : '#333333',
                        cursor: 'pointer',
                        transition: 'background-color 0.2s'
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.backgroundColor = '#3a3a3a';
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.backgroundColor = index % 2 === 0 ? '#2a2a2a' : '#333333';
                      }}
                    >
                      <td style={{ 
                        color: '#ffffff',
                        padding: '12px 8px',
                        fontFamily: 'monospace'
                      }}>
                        {ban.principal}
                      </td>
                      <td style={{ 
                        color: '#ffffff',
                        padding: '12px 8px'
                      }}>
                        {formatExpiry(ban.expiry)}
                      </td>
                      <td style={{ 
                        padding: '12px 8px',
                        textAlign: 'right'
                      }}>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleUnbanUser(ban.principal);
                          }}
                          disabled={isSubmitting}
                          style={{
                            backgroundColor: '#e74c3c',
                            color: '#ffffff',
                            border: 'none',
                            borderRadius: '4px',
                            padding: '6px 12px',
                            cursor: isSubmitting ? 'not-allowed' : 'pointer',
                            opacity: isSubmitting ? 0.7 : 1
                          }}
                        >
                          {isSubmitting ? 'Removing...' : 'Unban'}
                        </button>
                      </td>
                    </tr>
                    {expandedUser === ban.principal && (
                      <tr>
                        <td colSpan={3} style={{ 
                          backgroundColor: '#1a1a1a',
                          padding: '20px'
                        }}>
                          <div style={{ marginBottom: '10px', color: '#888' }}>
                            Ban History
                          </div>
                          {loadingHistory ? (
                            <div style={{ textAlign: 'center', padding: '20px', color: '#888' }}>
                              Loading history...
                            </div>
                          ) : banHistory.length === 0 ? (
                            <div style={{ color: '#888' }}>No ban history found.</div>
                          ) : (
                            <div style={{ 
                              display: 'flex',
                              flexDirection: 'column',
                              gap: '10px'
                            }}>
                              {banHistory.map((entry, i) => (
                                <div key={i} style={{
                                  backgroundColor: '#2a2a2a',
                                  padding: '15px',
                                  borderRadius: '4px',
                                  color: '#ffffff'
                                }}>
                                  <div style={{ 
                                    display: 'flex', 
                                    justifyContent: 'space-between',
                                    marginBottom: '8px',
                                    fontSize: '14px'
                                  }}>
                                    <span style={{ color: '#888' }}>
                                      {new Date(Number(entry.ban_timestamp) / 1000000).toLocaleString()}
                                    </span>
                                    <span style={{ 
                                      color: Number(entry.expiry_timestamp) === Number(entry.ban_timestamp) ? '#2ecc71' : '#e74c3c'
                                    }}>
                                      {Number(entry.expiry_timestamp) === Number(entry.ban_timestamp) ? 'Unbanned' : 'Banned'}
                                    </span>
                                  </div>
                                  <div style={{ marginBottom: '8px' }}>
                                    <strong style={{ color: '#888' }}>Admin: </strong>
                                    <span style={{ fontFamily: 'monospace' }}>{entry.admin.toString()}</span>
                                  </div>
                                  <div>
                                    <strong style={{ color: '#888' }}>Reason: </strong>
                                    {entry.reason}
                                  </div>
                                  {Number(entry.expiry_timestamp) !== Number(entry.ban_timestamp) && (
                                    <div style={{ marginTop: '8px' }}>
                                      <strong style={{ color: '#888' }}>Expiry: </strong>
                                      {new Date(Number(entry.expiry_timestamp) / 1000000).toLocaleString()}
                                    </div>
                                  )}
                                </div>
                              ))}
                            </div>
                          )}
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </main>
    </div>
  );
} 