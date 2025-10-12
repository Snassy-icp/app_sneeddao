import React, { useState, useEffect } from 'react';
import { useAuth } from '../../AuthContext';
import { useAdminCheck } from '../../hooks/useAdminCheck';
import { createActor as createSneedLockActor, canisterId as sneedLockCanisterId } from 'external/sneed_lock';
import Header from '../../components/Header';
import { Principal } from '@dfinity/principal';

export default function SneedLockAdmin() {
  const { isAuthenticated, identity } = useAuth();
  const [activeTab, setActiveTab] = useState('info');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  
  // Log state
  const [infoLogs, setInfoLogs] = useState([]);
  const [errorLogs, setErrorLogs] = useState([]);
  const [infoRange, setInfoRange] = useState(null);
  const [errorRange, setErrorRange] = useState(null);
  const [infoPage, setInfoPage] = useState(1);
  const [errorPage, setErrorPage] = useState(1);
  const pageSize = 50;
  
  // Admin functions state
  const [claimQueueStatus, setClaimQueueStatus] = useState(null);
  const [pauseReason, setPauseReason] = useState('');
  const [removeRequestId, setRemoveRequestId] = useState('');
  const [enforceZeroBalance, setEnforceZeroBalance] = useState(false);
  
  // Return token state
  const [returnTokenLedger, setReturnTokenLedger] = useState('');
  const [returnTokenAmount, setReturnTokenAmount] = useState('');
  const [returnTokenUser, setReturnTokenUser] = useState('');
  
  // Settings state
  const [tokenLockFee, setTokenLockFee] = useState('');
  const [maxLockLengthDays, setMaxLockLengthDays] = useState('');

  // Use admin check hook
  useAdminCheck({ identity, isAuthenticated });

  useEffect(() => {
    if (isAuthenticated && identity) {
      fetchInitialData();
    }
  }, [isAuthenticated, identity]);

  const getSneedLockActor = () => {
    if (!identity) return null;
    return createSneedLockActor(sneedLockCanisterId, {
      agentOptions: { identity }
    });
  };

  const fetchInitialData = async () => {
    setLoading(true);
    try {
      const actor = getSneedLockActor();
      if (!actor) return;

      const [infoRangeResult, errorRangeResult, queueStatus, enforceZero, lockFee] = await Promise.all([
        actor.get_info_id_range(),
        actor.get_error_id_range(),
        actor.get_claim_queue_status(),
        actor.get_enforce_zero_balance_before_claim(),
        actor.get_token_lock_fee_sneed_e8s()
      ]);

      const infoRangeData = infoRangeResult.length > 0 ? infoRangeResult[0] : null;
      const errorRangeData = errorRangeResult.length > 0 ? errorRangeResult[0] : null;

      setInfoRange(infoRangeData);
      setErrorRange(errorRangeData);
      setClaimQueueStatus(queueStatus);
      setEnforceZeroBalance(enforceZero);
      setTokenLockFee(Number(lockFee).toString());

      // Fetch first page of logs with the range data directly
      if (infoRangeData) {
        const [start, end] = infoRangeData;
        const startIdx = Math.max(Number(end) - pageSize, Number(start));
        const logs = await actor.get_info_entries(BigInt(startIdx), BigInt(pageSize));
        setInfoLogs(logs.filter(log => log.length > 0).map(log => log[0]));
        setInfoPage(1);
      }

      if (errorRangeData) {
        const [start, end] = errorRangeData;
        const startIdx = Math.max(Number(end) - pageSize, Number(start));
        const logs = await actor.get_error_entries(BigInt(startIdx), BigInt(pageSize));
        setErrorLogs(logs.filter(log => log.length > 0).map(log => log[0]));
        setErrorPage(1);
      }
    } catch (err) {
      console.error('Error fetching initial data:', err);
      setError('Failed to load initial data: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  const fetchInfoLogs = async (page) => {
    try {
      const actor = getSneedLockActor();
      if (!actor || !infoRange) return;

      const [start, end] = infoRange;
      const totalEntries = Number(end) - Number(start);
      const startIdx = Math.max(Number(end) - (page * pageSize), Number(start));
      
      const logs = await actor.get_info_entries(BigInt(startIdx), BigInt(pageSize));
      setInfoLogs(logs.filter(log => log.length > 0).map(log => log[0]));
      setInfoPage(page);
    } catch (err) {
      console.error('Error fetching info logs:', err);
      setError('Failed to fetch info logs: ' + err.message);
    }
  };

  const fetchErrorLogs = async (page) => {
    try {
      const actor = getSneedLockActor();
      if (!actor || !errorRange) return;

      const [start, end] = errorRange;
      const totalEntries = Number(end) - Number(start);
      const startIdx = Math.max(Number(end) - (page * pageSize), Number(start));
      
      const logs = await actor.get_error_entries(BigInt(startIdx), BigInt(pageSize));
      setErrorLogs(logs.filter(log => log.length > 0).map(log => log[0]));
      setErrorPage(page);
    } catch (err) {
      console.error('Error fetching error logs:', err);
      setError('Failed to fetch error logs: ' + err.message);
    }
  };

  const handlePauseQueue = async (e) => {
    e.preventDefault();
    if (!pauseReason.trim()) {
      setError('Please provide a reason for pausing the queue');
      return;
    }
    
    try {
      setLoading(true);
      setError('');
      setSuccess('');
      const actor = getSneedLockActor();
      if (!actor) throw new Error('Failed to create actor');

      await actor.admin_pause_claim_queue(pauseReason);
      setSuccess('Claim queue paused successfully');
      setPauseReason('');
      
      // Refresh queue status
      const queueStatus = await actor.get_claim_queue_status();
      setClaimQueueStatus(queueStatus);
    } catch (err) {
      console.error('Error pausing queue:', err);
      setError('Failed to pause queue: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleResumeQueue = async () => {
    try {
      setLoading(true);
      setError('');
      setSuccess('');
      const actor = getSneedLockActor();
      if (!actor) throw new Error('Failed to create actor');

      await actor.admin_resume_claim_queue();
      setSuccess('Claim queue resumed successfully');
      
      // Refresh queue status
      const queueStatus = await actor.get_claim_queue_status();
      setClaimQueueStatus(queueStatus);
    } catch (err) {
      console.error('Error resuming queue:', err);
      setError('Failed to resume queue: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleRemoveClaimRequest = async (e) => {
    e.preventDefault();
    if (!removeRequestId) {
      setError('Please provide a request ID');
      return;
    }
    
    try {
      setLoading(true);
      setError('');
      setSuccess('');
      const actor = getSneedLockActor();
      if (!actor) throw new Error('Failed to create actor');

      const result = await actor.admin_remove_active_claim_request(BigInt(removeRequestId));
      if (result) {
        setSuccess('Claim request removed successfully');
        setRemoveRequestId('');
      } else {
        setError('Claim request not found or already removed');
      }
      
      // Refresh queue status
      const queueStatus = await actor.get_claim_queue_status();
      setClaimQueueStatus(queueStatus);
    } catch (err) {
      console.error('Error removing claim request:', err);
      setError('Failed to remove claim request: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleClearCompletedBuffer = async () => {
    try {
      setLoading(true);
      setError('');
      setSuccess('');
      const actor = getSneedLockActor();
      if (!actor) throw new Error('Failed to create actor');

      const cleared = await actor.admin_clear_completed_claim_requests_buffer();
      setSuccess(`Cleared ${cleared} completed claim requests from buffer`);
      
      // Refresh queue status
      const queueStatus = await actor.get_claim_queue_status();
      setClaimQueueStatus(queueStatus);
    } catch (err) {
      console.error('Error clearing buffer:', err);
      setError('Failed to clear buffer: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleSetEnforceZeroBalance = async (value) => {
    try {
      setLoading(true);
      setError('');
      setSuccess('');
      const actor = getSneedLockActor();
      if (!actor) throw new Error('Failed to create actor');

      await actor.admin_set_enforce_zero_balance_before_claim(value);
      setEnforceZeroBalance(value);
      setSuccess(`Enforce zero balance ${value ? 'enabled' : 'disabled'} successfully`);
    } catch (err) {
      console.error('Error setting enforce zero balance:', err);
      setError('Failed to set enforce zero balance: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleReturnToken = async (e) => {
    e.preventDefault();
    if (!returnTokenLedger || !returnTokenAmount || !returnTokenUser) {
      setError('Please fill in all return token fields');
      return;
    }
    
    try {
      setLoading(true);
      setError('');
      setSuccess('');
      const actor = getSneedLockActor();
      if (!actor) throw new Error('Failed to create actor');

      const ledgerPrincipal = Principal.fromText(returnTokenLedger);
      const userPrincipal = Principal.fromText(returnTokenUser);
      const amount = BigInt(returnTokenAmount);

      const result = await actor.admin_return_token(ledgerPrincipal, amount, userPrincipal);
      
      if ('Ok' in result) {
        setSuccess(`Token returned successfully. Transfer index: ${result.Ok}`);
        setReturnTokenLedger('');
        setReturnTokenAmount('');
        setReturnTokenUser('');
      } else {
        setError(`Failed to return token: ${JSON.stringify(result.Err)}`);
      }
    } catch (err) {
      console.error('Error returning token:', err);
      setError('Failed to return token: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  const formatTimestamp = (timestamp) => {
    try {
      const ms = Number(timestamp) / 1_000_000;
      return new Date(ms).toLocaleString();
    } catch (err) {
      return 'Invalid date';
    }
  };

  const formatPrincipal = (principal) => {
    const text = principal.toString();
    if (text.length <= 20) return text;
    return `${text.slice(0, 10)}...${text.slice(-6)}`;
  };

  const renderInfoLogs = () => (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
        <h2 style={{ color: '#ffffff', fontSize: '24px' }}>Info Logs</h2>
        {infoRange && (
          <div style={{ color: '#888' }}>
            Total entries: {Number(infoRange[1]) - Number(infoRange[0])}
          </div>
        )}
      </div>
      
      <div style={{ marginBottom: '20px' }}>
        <button
          onClick={() => fetchInfoLogs(Math.max(1, infoPage - 1))}
          disabled={infoPage === 1}
          style={{
            backgroundColor: '#3498db',
            color: '#ffffff',
            border: 'none',
            borderRadius: '4px',
            padding: '8px 16px',
            marginRight: '10px',
            cursor: 'pointer',
            opacity: infoPage === 1 ? 0.5 : 1
          }}
        >
          ← Newer
        </button>
        <button
          onClick={() => fetchInfoLogs(infoPage + 1)}
          disabled={!infoRange || Number(infoRange[1]) - (infoPage * pageSize) <= Number(infoRange[0])}
          style={{
            backgroundColor: '#3498db',
            color: '#ffffff',
            border: 'none',
            borderRadius: '4px',
            padding: '8px 16px',
            cursor: 'pointer',
            opacity: !infoRange || Number(infoRange[1]) - (infoPage * pageSize) <= Number(infoRange[0]) ? 0.5 : 1
          }}
        >
          Older →
        </button>
        <span style={{ color: '#888', marginLeft: '20px' }}>Page {infoPage}</span>
      </div>

      <div style={{ backgroundColor: '#1a1a1a', borderRadius: '8px', padding: '20px', border: '1px solid #3a3a3a' }}>
        {infoLogs.length === 0 ? (
          <div style={{ color: '#888', textAlign: 'center', padding: '20px' }}>No info logs available</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {infoLogs.map((log) => (
              <div
                key={log.id.toString()}
                style={{
                  backgroundColor: '#2a2a2a',
                  borderRadius: '4px',
                  padding: '12px',
                  border: '1px solid #3a3a3a'
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                  <span style={{ color: '#3498db', fontSize: '12px' }}>ID: {Number(log.id)}</span>
                  <span style={{ color: '#888', fontSize: '12px' }}>
                    {formatTimestamp(log.timestamp)}
                  </span>
                </div>
                <div style={{ color: '#ffffff', marginBottom: '4px', wordBreak: 'break-word' }}>
                  {log.content}
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px' }}>
                  <span style={{ color: '#888' }}>
                    Caller: {formatPrincipal(log.caller)}
                  </span>
                  <span style={{ color: '#888' }}>
                    Correlation: {Number(log.correlation_id)}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );

  const renderErrorLogs = () => (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
        <h2 style={{ color: '#ffffff', fontSize: '24px' }}>Error Logs</h2>
        {errorRange && (
          <div style={{ color: '#888' }}>
            Total entries: {Number(errorRange[1]) - Number(errorRange[0])}
          </div>
        )}
      </div>
      
      <div style={{ marginBottom: '20px' }}>
        <button
          onClick={() => fetchErrorLogs(Math.max(1, errorPage - 1))}
          disabled={errorPage === 1}
          style={{
            backgroundColor: '#e74c3c',
            color: '#ffffff',
            border: 'none',
            borderRadius: '4px',
            padding: '8px 16px',
            marginRight: '10px',
            cursor: 'pointer',
            opacity: errorPage === 1 ? 0.5 : 1
          }}
        >
          ← Newer
        </button>
        <button
          onClick={() => fetchErrorLogs(errorPage + 1)}
          disabled={!errorRange || Number(errorRange[1]) - (errorPage * pageSize) <= Number(errorRange[0])}
          style={{
            backgroundColor: '#e74c3c',
            color: '#ffffff',
            border: 'none',
            borderRadius: '4px',
            padding: '8px 16px',
            cursor: 'pointer',
            opacity: !errorRange || Number(errorRange[1]) - (errorPage * pageSize) <= Number(errorRange[0]) ? 0.5 : 1
          }}
        >
          Older →
        </button>
        <span style={{ color: '#888', marginLeft: '20px' }}>Page {errorPage}</span>
      </div>

      <div style={{ backgroundColor: '#1a1a1a', borderRadius: '8px', padding: '20px', border: '1px solid #3a3a3a' }}>
        {errorLogs.length === 0 ? (
          <div style={{ color: '#888', textAlign: 'center', padding: '20px' }}>No error logs available</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {errorLogs.map((log) => (
              <div
                key={log.id.toString()}
                style={{
                  backgroundColor: 'rgba(231, 76, 60, 0.1)',
                  borderRadius: '4px',
                  padding: '12px',
                  border: '1px solid #e74c3c'
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                  <span style={{ color: '#e74c3c', fontSize: '12px' }}>ID: {Number(log.id)}</span>
                  <span style={{ color: '#888', fontSize: '12px' }}>
                    {formatTimestamp(log.timestamp)}
                  </span>
                </div>
                <div style={{ color: '#ffffff', marginBottom: '4px', wordBreak: 'break-word' }}>
                  {log.content}
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px' }}>
                  <span style={{ color: '#888' }}>
                    Caller: {formatPrincipal(log.caller)}
                  </span>
                  <span style={{ color: '#888' }}>
                    Correlation: {Number(log.correlation_id)}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );

  const renderAdminFunctions = () => (
    <div>
      <h2 style={{ color: '#ffffff', fontSize: '24px', marginBottom: '20px' }}>Admin Functions</h2>
      
      {/* Claim Queue Status */}
      {claimQueueStatus && (
        <div style={{
          backgroundColor: '#2a2a2a',
          borderRadius: '8px',
          padding: '20px',
          marginBottom: '20px',
          border: '1px solid #3a3a3a'
        }}>
          <h3 style={{ color: '#ffffff', fontSize: '18px', marginBottom: '15px' }}>Claim Queue Status</h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '15px' }}>
            <div>
              <div style={{ color: '#888', fontSize: '12px' }}>Status</div>
              <div style={{ color: 'Active' in claimQueueStatus.processing_state ? '#2ecc71' : '#e74c3c', fontSize: '16px' }}>
                {'Active' in claimQueueStatus.processing_state ? 'Active' : 
                 `Paused: ${claimQueueStatus.processing_state.Paused}`}
              </div>
            </div>
            <div>
              <div style={{ color: '#888', fontSize: '12px' }}>Pending</div>
              <div style={{ color: '#ffffff', fontSize: '16px' }}>{Number(claimQueueStatus.pending_count)}</div>
            </div>
            <div>
              <div style={{ color: '#888', fontSize: '12px' }}>Processing</div>
              <div style={{ color: '#ffffff', fontSize: '16px' }}>{Number(claimQueueStatus.processing_count)}</div>
            </div>
            <div>
              <div style={{ color: '#888', fontSize: '12px' }}>Active Total</div>
              <div style={{ color: '#ffffff', fontSize: '16px' }}>{Number(claimQueueStatus.active_total)}</div>
            </div>
            <div>
              <div style={{ color: '#888', fontSize: '12px' }}>Completed (Buffer)</div>
              <div style={{ color: '#ffffff', fontSize: '16px' }}>{Number(claimQueueStatus.completed_buffer_count)}</div>
            </div>
          </div>
          <div style={{ marginTop: '15px', display: 'flex', gap: '10px' }}>
            {'Active' in claimQueueStatus.processing_state ? (
              <>
                <button
                  onClick={() => document.getElementById('pause-form').style.display = 'block'}
                  style={{
                    backgroundColor: '#e74c3c',
                    color: '#ffffff',
                    border: 'none',
                    borderRadius: '4px',
                    padding: '8px 16px',
                    cursor: 'pointer'
                  }}
                >
                  Pause Queue
                </button>
                <form
                  id="pause-form"
                  onSubmit={handlePauseQueue}
                  style={{ display: 'none', flex: 1 }}
                >
                  <input
                    type="text"
                    placeholder="Reason for pausing"
                    value={pauseReason}
                    onChange={(e) => setPauseReason(e.target.value)}
                    style={{
                      padding: '8px',
                      borderRadius: '4px',
                      border: '1px solid #3a3a3a',
                      backgroundColor: '#1a1a1a',
                      color: '#ffffff',
                      marginRight: '10px',
                      width: '300px'
                    }}
                  />
                  <button
                    type="submit"
                    style={{
                      backgroundColor: '#e74c3c',
                      color: '#ffffff',
                      border: 'none',
                      borderRadius: '4px',
                      padding: '8px 16px',
                      cursor: 'pointer'
                    }}
                  >
                    Confirm Pause
                  </button>
                </form>
              </>
            ) : (
              <button
                onClick={handleResumeQueue}
                style={{
                  backgroundColor: '#2ecc71',
                  color: '#ffffff',
                  border: 'none',
                  borderRadius: '4px',
                  padding: '8px 16px',
                  cursor: 'pointer'
                }}
              >
                Resume Queue
              </button>
            )}
            <button
              onClick={handleClearCompletedBuffer}
              style={{
                backgroundColor: '#3498db',
                color: '#ffffff',
                border: 'none',
                borderRadius: '4px',
                padding: '8px 16px',
                cursor: 'pointer'
              }}
            >
              Clear Completed Buffer
            </button>
          </div>
        </div>
      )}

      {/* Remove Claim Request */}
      <div style={{
        backgroundColor: '#2a2a2a',
        borderRadius: '8px',
        padding: '20px',
        marginBottom: '20px',
        border: '1px solid #3a3a3a'
      }}>
        <h3 style={{ color: '#ffffff', fontSize: '18px', marginBottom: '15px' }}>Remove Active Claim Request</h3>
        <form onSubmit={handleRemoveClaimRequest} style={{ display: 'flex', gap: '10px', alignItems: 'flex-end' }}>
          <div style={{ flex: 1 }}>
            <label style={{ color: '#888', fontSize: '12px', display: 'block', marginBottom: '5px' }}>
              Request ID
            </label>
            <input
              type="text"
              placeholder="Enter request ID"
              value={removeRequestId}
              onChange={(e) => setRemoveRequestId(e.target.value)}
              style={{
                width: '100%',
                padding: '10px',
                borderRadius: '4px',
                border: '1px solid #3a3a3a',
                backgroundColor: '#1a1a1a',
                color: '#ffffff'
              }}
            />
          </div>
          <button
            type="submit"
            style={{
              backgroundColor: '#e74c3c',
              color: '#ffffff',
              border: 'none',
              borderRadius: '4px',
              padding: '10px 20px',
              cursor: 'pointer'
            }}
          >
            Remove Request
          </button>
        </form>
      </div>

      {/* Return Token */}
      <div style={{
        backgroundColor: '#2a2a2a',
        borderRadius: '8px',
        padding: '20px',
        marginBottom: '20px',
        border: '1px solid #3a3a3a'
      }}>
        <h3 style={{ color: '#ffffff', fontSize: '18px', marginBottom: '15px' }}>Return Token to User</h3>
        <form onSubmit={handleReturnToken}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '15px' }}>
            <div>
              <label style={{ color: '#888', fontSize: '12px', display: 'block', marginBottom: '5px' }}>
                Ledger Canister ID
              </label>
              <input
                type="text"
                placeholder="Principal of ICRC-1 ledger"
                value={returnTokenLedger}
                onChange={(e) => setReturnTokenLedger(e.target.value)}
                style={{
                  width: '100%',
                  padding: '10px',
                  borderRadius: '4px',
                  border: '1px solid #3a3a3a',
                  backgroundColor: '#1a1a1a',
                  color: '#ffffff'
                }}
              />
            </div>
            <div>
              <label style={{ color: '#888', fontSize: '12px', display: 'block', marginBottom: '5px' }}>
                Amount (in smallest unit)
              </label>
              <input
                type="text"
                placeholder="Amount to return"
                value={returnTokenAmount}
                onChange={(e) => setReturnTokenAmount(e.target.value)}
                style={{
                  width: '100%',
                  padding: '10px',
                  borderRadius: '4px',
                  border: '1px solid #3a3a3a',
                  backgroundColor: '#1a1a1a',
                  color: '#ffffff'
                }}
              />
            </div>
            <div>
              <label style={{ color: '#888', fontSize: '12px', display: 'block', marginBottom: '5px' }}>
                User Principal
              </label>
              <input
                type="text"
                placeholder="Principal to return tokens to"
                value={returnTokenUser}
                onChange={(e) => setReturnTokenUser(e.target.value)}
                style={{
                  width: '100%',
                  padding: '10px',
                  borderRadius: '4px',
                  border: '1px solid #3a3a3a',
                  backgroundColor: '#1a1a1a',
                  color: '#ffffff'
                }}
              />
            </div>
          </div>
          <button
            type="submit"
            style={{
              backgroundColor: '#3498db',
              color: '#ffffff',
              border: 'none',
              borderRadius: '4px',
              padding: '10px 20px',
              marginTop: '15px',
              cursor: 'pointer'
            }}
          >
            Return Token
          </button>
        </form>
      </div>
    </div>
  );

  const renderSettings = () => (
    <div>
      <h2 style={{ color: '#ffffff', fontSize: '24px', marginBottom: '20px' }}>Settings</h2>
      
      {/* Enforce Zero Balance */}
      <div style={{
        backgroundColor: '#2a2a2a',
        borderRadius: '8px',
        padding: '20px',
        marginBottom: '20px',
        border: '1px solid #3a3a3a'
      }}>
        <h3 style={{ color: '#ffffff', fontSize: '18px', marginBottom: '15px' }}>Enforce Zero Balance Before Claim</h3>
        <p style={{ color: '#888', fontSize: '14px', marginBottom: '15px' }}>
          When enabled, users must have zero balance of both tokens in their subaccount before claiming position fees.
        </p>
        <div style={{ display: 'flex', alignItems: 'center', gap: '15px' }}>
          <span style={{ color: '#ffffff' }}>
            Currently: <strong style={{ color: enforceZeroBalance ? '#2ecc71' : '#e74c3c' }}>
              {enforceZeroBalance ? 'Enabled' : 'Disabled'}
            </strong>
          </span>
          <button
            onClick={() => handleSetEnforceZeroBalance(!enforceZeroBalance)}
            style={{
              backgroundColor: enforceZeroBalance ? '#e74c3c' : '#2ecc71',
              color: '#ffffff',
              border: 'none',
              borderRadius: '4px',
              padding: '8px 16px',
              cursor: 'pointer'
            }}
          >
            {enforceZeroBalance ? 'Disable' : 'Enable'}
          </button>
        </div>
      </div>

      {/* Token Lock Fee (Read Only) */}
      <div style={{
        backgroundColor: '#2a2a2a',
        borderRadius: '8px',
        padding: '20px',
        marginBottom: '20px',
        border: '1px solid #3a3a3a'
      }}>
        <h3 style={{ color: '#ffffff', fontSize: '18px', marginBottom: '15px' }}>Token Lock Fee</h3>
        <p style={{ color: '#888', fontSize: '14px', marginBottom: '15px' }}>
          Current fee in SNEED (e8s): <strong style={{ color: '#ffffff' }}>{tokenLockFee}</strong>
        </p>
        <p style={{ color: '#666', fontSize: '12px' }}>
          Note: Use set_token_lock_fee_sneed_e8s function via dfx to update this value
        </p>
      </div>
    </div>
  );

  if (!isAuthenticated) {
    return (
      <div className='page-container'>
        <Header />
        <div style={{ padding: '40px 20px', textAlign: 'center', color: '#ffffff' }}>
          <h2>Please log in to access SneedLock Admin</h2>
        </div>
      </div>
    );
  }

  return (
    <div className='page-container'>
      <Header />
      <main style={{ 
        padding: '40px 20px', 
        maxWidth: '1400px', 
        margin: '0 auto',
        color: '#ffffff'
      }}>
        <h1 style={{ 
          fontSize: '32px', 
          fontWeight: 'bold', 
          marginBottom: '10px',
          color: '#ffffff'
        }}>
          SneedLock Administration
        </h1>
        <p style={{ color: '#888', marginBottom: '30px' }}>
          Manage SneedLock backend: logs, admin functions, and settings
        </p>

        {/* Status Messages */}
        {error && (
          <div style={{
            backgroundColor: 'rgba(231, 76, 60, 0.1)',
            border: '1px solid #e74c3c',
            borderRadius: '8px',
            padding: '12px',
            marginBottom: '20px',
            color: '#e74c3c'
          }}>
            {error}
          </div>
        )}

        {success && (
          <div style={{
            backgroundColor: 'rgba(46, 204, 113, 0.1)',
            border: '1px solid #2ecc71',
            borderRadius: '8px',
            padding: '12px',
            marginBottom: '20px',
            color: '#2ecc71'
          }}>
            {success}
          </div>
        )}

        {/* Tabs */}
        <div style={{ 
          display: 'flex', 
          gap: '10px', 
          marginBottom: '30px',
          borderBottom: '1px solid #3a3a3a',
          paddingBottom: '10px'
        }}>
          {['info', 'error', 'functions', 'settings'].map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              style={{
                backgroundColor: activeTab === tab ? '#3498db' : 'transparent',
                color: activeTab === tab ? '#ffffff' : '#888',
                border: 'none',
                borderRadius: '4px',
                padding: '10px 20px',
                cursor: 'pointer',
                fontSize: '16px',
                fontWeight: activeTab === tab ? 'bold' : 'normal',
                transition: 'all 0.2s ease'
              }}
            >
              {tab === 'info' && 'Info Logs'}
              {tab === 'error' && 'Error Logs'}
              {tab === 'functions' && 'Admin Functions'}
              {tab === 'settings' && 'Settings'}
            </button>
          ))}
        </div>

        {/* Tab Content */}
        {loading ? (
          <div style={{ textAlign: 'center', padding: '40px', color: '#888' }}>
            Loading...
          </div>
        ) : (
          <>
            {activeTab === 'info' && renderInfoLogs()}
            {activeTab === 'error' && renderErrorLogs()}
            {activeTab === 'functions' && renderAdminFunctions()}
            {activeTab === 'settings' && renderSettings()}
          </>
        )}
      </main>
    </div>
  );
}

