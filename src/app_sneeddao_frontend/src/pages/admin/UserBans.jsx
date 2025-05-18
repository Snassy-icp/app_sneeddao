import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../AuthContext';
import { useAdminCheck } from '../../hooks/useAdminCheck';
import { Principal } from '@dfinity/principal';
import Header from '../../components/Header';
import { createActor } from 'declarations/app_sneeddao_backend';
import { canisterId } from 'declarations/app_sneeddao_backend';

export default function UserBans() {
  const { isAuthenticated, identity } = useAuth();
  const { isAdmin, loading: adminLoading, error: adminError } = useAdminCheck({ identity, isAuthenticated });
  const navigate = useNavigate();

  const [bannedUsers, setBannedUsers] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [principalId, setPrincipalId] = useState('');
  const [banDuration, setBanDuration] = useState(24);
  const [banReason, setBanReason] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Create backend actor when identity changes
  const backendActor = React.useMemo(() => {
    if (!identity) return null;
    return createActor(canisterId, {
      agentOptions: {
        identity,
        host: process.env.DFX_NETWORK === 'ic' ? 'https://icp0.io' : 'http://localhost:4943',
      },
    });
  }, [identity]);

  useEffect(() => {
    if (!isAuthenticated) {
      navigate('/wallet');
      return;
    }
    if (identity && backendActor) {
      fetchBans();
    }
  }, [isAuthenticated, identity, backendActor]);

  const fetchBans = async () => {
    if (!identity || !backendActor) return;
    
    setLoading(true);
    setError('');
    try {
      const result = await backendActor.get_banned_users();
      if ('ok' in result) {
        setBannedUsers(result.ok);
      } else {
        setError('Error fetching bans: ' + result.err);
      }
    } catch (err) {
      setError('Error fetching bans: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleBanUser = async (e) => {
    e.preventDefault();
    if (!identity || !backendActor) return;

    setIsSubmitting(true);
    setError('');
    try {
      let principal;
      try {
        principal = Principal.fromText(principalId);
      } catch (err) {
        throw new Error('Invalid principal ID format');
      }

      const result = await backendActor.ban_user(principal, BigInt(banDuration), banReason);
      if ('ok' in result) {
        setPrincipalId('');
        setBanReason('');
        await fetchBans();
      } else {
        setError('Failed to ban user: ' + result.err);
      }
    } catch (err) {
      setError('Error banning user: ' + err.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleUnbanUser = async (principal) => {
    if (!identity || !backendActor) return;

    setIsSubmitting(true);
    setError('');
    try {
      const result = await backendActor.unban_user(principal);
      if ('ok' in result) {
        await fetchBans();
      } else {
        setError('Failed to unban user: ' + result.err);
      }
    } catch (err) {
      setError('Error unbanning user: ' + err.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  if (adminLoading) {
    return (
      <div className="container mx-auto px-4 py-8">
        <Header />
        <div className="text-center py-4">Loading...</div>
      </div>
    );
  }

  if (adminError || !isAdmin) {
    return (
      <div className="container mx-auto px-4 py-8">
        <Header />
        <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded mb-4">
          {adminError || "You do not have admin privileges"}
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 py-8">
      <Header />
      <h1 className="text-3xl font-bold mb-8">User Bans Management</h1>

      {error && (
        <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded mb-4">
          {error}
        </div>
      )}

      <form onSubmit={handleBanUser} className="mb-8 bg-white shadow-md rounded px-8 pt-6 pb-8">
        <div className="mb-4">
          <label className="block text-gray-700 text-sm font-bold mb-2">
            Principal ID
          </label>
          <input
            type="text"
            value={principalId}
            onChange={(e) => setPrincipalId(e.target.value)}
            className="shadow appearance-none border rounded w-full py-2 px-3 text-gray-700 leading-tight focus:outline-none focus:shadow-outline"
            placeholder="Enter principal ID to ban"
            required
          />
        </div>

        <div className="mb-4">
          <label className="block text-gray-700 text-sm font-bold mb-2">
            Ban Duration (hours)
          </label>
          <input
            type="number"
            value={banDuration}
            onChange={(e) => setBanDuration(parseInt(e.target.value))}
            className="shadow appearance-none border rounded w-full py-2 px-3 text-gray-700 leading-tight focus:outline-none focus:shadow-outline"
            min="1"
            required
          />
        </div>

        <div className="mb-4">
          <label className="block text-gray-700 text-sm font-bold mb-2">
            Ban Reason
          </label>
          <input
            type="text"
            value={banReason}
            onChange={(e) => setBanReason(e.target.value)}
            className="shadow appearance-none border rounded w-full py-2 px-3 text-gray-700 leading-tight focus:outline-none focus:shadow-outline"
            placeholder="Enter reason for ban"
            required
          />
        </div>

        <button
          type="submit"
          disabled={isSubmitting}
          className="bg-red-500 hover:bg-red-700 text-white font-bold py-2 px-4 rounded focus:outline-none focus:shadow-outline disabled:opacity-50"
        >
          {isSubmitting ? 'Banning...' : 'Ban User'}
        </button>
      </form>

      <div className="bg-white shadow-md rounded px-8 pt-6 pb-8">
        <h2 className="text-2xl font-bold mb-4">Currently Banned Users</h2>
        {loading ? (
          <div className="text-center py-4">Loading banned users...</div>
        ) : bannedUsers.length === 0 ? (
          <div className="text-gray-600">No users are currently banned.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full table-auto">
              <thead>
                <tr className="bg-gray-100">
                  <th className="px-4 py-2 text-left">Principal ID</th>
                  <th className="px-4 py-2 text-left">Expiry Time</th>
                  <th className="px-4 py-2 text-left">Actions</th>
                </tr>
              </thead>
              <tbody>
                {bannedUsers.map(([principal, expiry]) => (
                  <tr key={principal.toString()} className="border-b">
                    <td className="px-4 py-2">{principal.toString()}</td>
                    <td className="px-4 py-2">
                      {new Date(Number(expiry) / 1000000).toLocaleString()}
                    </td>
                    <td className="px-4 py-2">
                      <button
                        onClick={() => handleUnbanUser(principal)}
                        disabled={isSubmitting}
                        className="bg-blue-500 hover:bg-blue-700 text-white font-bold py-1 px-3 rounded text-sm focus:outline-none focus:shadow-outline disabled:opacity-50"
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
    </div>
  );
} 