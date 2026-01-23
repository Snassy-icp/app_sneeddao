import React, { useState, useEffect } from 'react';
import { useAuth } from '../../AuthContext';
import { useAdminCheck } from '../../hooks/useAdminCheck';
import { createActor as createSneedLockActor, canisterId as sneedLockCanisterId } from 'declarations/sneed_lock';
import Header from '../../components/Header';
import { Principal } from '@dfinity/principal';

export default function SneedLockAdmin() {
  const { isAuthenticated, identity } = useAuth();
  const [activeTab, setActiveTab] = useState('queue');
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
  
  // Claim request state
  const [activeClaimRequests, setActiveClaimRequests] = useState([]);
  const [completedClaimRequests, setCompletedClaimRequests] = useState([]);
  const [failedClaimRequests, setFailedClaimRequests] = useState([]);
  const [selectedRequest, setSelectedRequest] = useState(null);
  
  // Timer state
  const [timerStatus, setTimerStatus] = useState(null);
  
  // Admin functions state
  const [claimQueueStatus, setClaimQueueStatus] = useState(null);
  const [pauseReason, setPauseReason] = useState('');
  const [removeRequestId, setRemoveRequestId] = useState('');
  const [retryRequestId, setRetryRequestId] = useState('');
  const [enforceZeroBalance, setEnforceZeroBalance] = useState(false);
  
  // New admin function state
  const [addAdminPrincipal, setAddAdminPrincipal] = useState('');
  const [rescueTokenLedger, setRescueTokenLedger] = useState('');
  const [rescueTokenRecipient, setRescueTokenRecipient] = useState('');
  const [returnFailedRequestLedger, setReturnFailedRequestLedger] = useState('');
  const [returnFailedRequestAmount, setReturnFailedRequestAmount] = useState('');
  const [returnFailedRequestRecipient, setReturnFailedRequestRecipient] = useState('');
  
  // Return token state
  const [returnTokenLedger, setReturnTokenLedger] = useState('');
  const [returnTokenAmount, setReturnTokenAmount] = useState('');
  const [returnTokenUser, setReturnTokenUser] = useState('');
  
  // Settings state
  const [maxLockLengthDays, setMaxLockLengthDays] = useState('');
  
  // ICP Lock Fee state
  const [icpFeeConfig, setIcpFeeConfig] = useState(null);
  const [tokenLockFeeIcp, setTokenLockFeeIcp] = useState('');
  const [positionLockFeeIcp, setPositionLockFeeIcp] = useState('');
  const [premiumTokenLockFeeIcp, setPremiumTokenLockFeeIcp] = useState('');
  const [premiumPositionLockFeeIcp, setPremiumPositionLockFeeIcp] = useState('');
  const [premiumCanisterId, setPremiumCanisterId] = useState('');
  
  // Admin list state
  const [adminList, setAdminList] = useState([]);
  const [removeAdminPrincipal, setRemoveAdminPrincipal] = useState('');

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

      const [infoRangeResult, errorRangeResult, queueStatus, enforceZero, timer, activeReqs, completedReqs, failedReqs, admins, icpFees] = await Promise.all([
        actor.get_info_id_range(),
        actor.get_error_id_range(),
        actor.get_claim_queue_status(),
        actor.get_enforce_zero_balance_before_claim(),
        actor.get_timer_status(),
        actor.get_all_active_claim_requests(),
        actor.get_all_completed_claim_requests(),
        actor.get_all_failed_claim_requests(),
        actor.get_admin_list(),
        actor.get_lock_fees_icp()
      ]);

      const infoRangeData = infoRangeResult.length > 0 ? infoRangeResult[0] : null;
      const errorRangeData = errorRangeResult.length > 0 ? errorRangeResult[0] : null;

      setInfoRange(infoRangeData);
      setErrorRange(errorRangeData);
      setClaimQueueStatus(queueStatus);
      setEnforceZeroBalance(enforceZero);
      setTimerStatus(timer);
      setActiveClaimRequests(activeReqs);
      setCompletedClaimRequests(completedReqs);
      setFailedClaimRequests(failedReqs);
      setAdminList(admins);
      
      // Set ICP fee config
      setIcpFeeConfig(icpFees);
      setTokenLockFeeIcp(Number(icpFees.token_lock_fee_icp_e8s).toString());
      setPositionLockFeeIcp(Number(icpFees.position_lock_fee_icp_e8s).toString());
      setPremiumTokenLockFeeIcp(Number(icpFees.premium_token_lock_fee_icp_e8s).toString());
      setPremiumPositionLockFeeIcp(Number(icpFees.premium_position_lock_fee_icp_e8s).toString());
      if (icpFees.sneed_premium_canister_id && icpFees.sneed_premium_canister_id.length > 0) {
        setPremiumCanisterId(icpFees.sneed_premium_canister_id[0].toString());
      }

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

  const handleTriggerProcessing = async () => {
    try {
      setLoading(true);
      setError('');
      setSuccess('');
      const actor = getSneedLockActor();
      if (!actor) throw new Error('Failed to create actor');

      const result = await actor.admin_trigger_claim_processing();
      setSuccess(`Processing triggered: ${result}`);
      
      // Refresh data
      await fetchInitialData();
    } catch (err) {
      console.error('Error triggering processing:', err);
      setError('Failed to trigger processing: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleEmergencyStopTimer = async () => {
    if (!window.confirm('Are you sure you want to EMERGENCY STOP the timer? This will stop all automatic processing!')) {
      return;
    }
    
    try {
      setLoading(true);
      setError('');
      setSuccess('');
      const actor = getSneedLockActor();
      if (!actor) throw new Error('Failed to create actor');

      await actor.admin_emergency_stop_timer();
      setSuccess('Timer stopped successfully! Automatic processing is now disabled.');
      
      // Refresh timer status
      const timer = await actor.get_timer_status();
      setTimerStatus(timer);
    } catch (err) {
      console.error('Error stopping timer:', err);
      setError('Failed to stop timer: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleRetryRequest = async (e) => {
    e.preventDefault();
    if (!retryRequestId) {
      setError('Please provide a request ID');
      return;
    }
    
    try {
      setLoading(true);
      setError('');
      setSuccess('');
      const actor = getSneedLockActor();
      if (!actor) throw new Error('Failed to create actor');

      const result = await actor.admin_retry_claim_request(BigInt(retryRequestId));
      
      if ('Ok' in result) {
        setSuccess(`Request retry initiated: ${result.Ok}`);
        setRetryRequestId('');
      } else {
        setError(`Failed to retry request: ${result.Err}`);
      }
      
      // Refresh claim requests
      const activeReqs = await actor.get_all_active_claim_requests();
      setActiveClaimRequests(activeReqs);
    } catch (err) {
      console.error('Error retrying request:', err);
      setError('Failed to retry request: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleAddAdmin = async (e) => {
    e.preventDefault();
    if (!addAdminPrincipal) {
      setError('Please provide an admin principal to add');
      return;
    }
    
    try {
      setLoading(true);
      setError('');
      setSuccess('');
      const actor = getSneedLockActor();
      if (!actor) throw new Error('Failed to create actor');

      const adminPrincipal = Principal.fromText(addAdminPrincipal);
      const result = await actor.admin_add_admin(adminPrincipal);
      
      if ('Ok' in result) {
        setSuccess(`Admin added: ${result.Ok}`);
        setAddAdminPrincipal('');
        
        // Refresh admin list
        const admins = await actor.get_admin_list();
        setAdminList(admins);
      } else {
        setError(`Failed to add admin: ${result.Err}`);
      }
    } catch (err) {
      console.error('Error adding admin:', err);
      setError('Failed to add admin: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleClearCompletedRequests = async () => {
    if (!window.confirm('Are you sure you want to clear all completed claim requests?')) {
      return;
    }
    
    try {
      setLoading(true);
      setError('');
      setSuccess('');
      const actor = getSneedLockActor();
      if (!actor) throw new Error('Failed to create actor');

      const cleared = await actor.admin_clear_completed_claim_requests();
      setSuccess(`Cleared ${cleared} completed claim requests`);
      
      // Refresh claim requests
      await refreshClaimRequests();
    } catch (err) {
      console.error('Error clearing completed requests:', err);
      setError('Failed to clear completed requests: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleClearFailedRequests = async () => {
    if (!window.confirm('Are you sure you want to clear all failed claim requests?')) {
      return;
    }
    
    try {
      setLoading(true);
      setError('');
      setSuccess('');
      const actor = getSneedLockActor();
      if (!actor) throw new Error('Failed to create actor');

      const cleared = await actor.admin_clear_failed_claim_requests();
      setSuccess(`Cleared ${cleared} failed claim requests`);
      
      // Refresh claim requests
      await refreshClaimRequests();
    } catch (err) {
      console.error('Error clearing failed requests:', err);
      setError('Failed to clear failed requests: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleRescueStuckTokens = async (e) => {
    e.preventDefault();
    if (!rescueTokenLedger || !rescueTokenRecipient) {
      setError('Please fill in all rescue token fields');
      return;
    }
    
    if (!window.confirm(`Are you sure you want to rescue all stuck tokens from ledger ${rescueTokenLedger}?`)) {
      return;
    }
    
    try {
      setLoading(true);
      setError('');
      setSuccess('');
      const actor = getSneedLockActor();
      if (!actor) throw new Error('Failed to create actor');

      const ledgerPrincipal = Principal.fromText(rescueTokenLedger);
      const recipientPrincipal = Principal.fromText(rescueTokenRecipient);

      const result = await actor.admin_rescue_stuck_tokens(ledgerPrincipal, recipientPrincipal);
      
      if ('Ok' in result) {
        setSuccess(`Tokens rescued: ${result.Ok}`);
        setRescueTokenLedger('');
        setRescueTokenRecipient('');
      } else {
        setError(`Failed to rescue tokens: ${result.Err}`);
      }
    } catch (err) {
      console.error('Error rescuing tokens:', err);
      setError('Failed to rescue tokens: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleReturnTokenFromFailedRequest = async (e) => {
    e.preventDefault();
    if (!returnFailedRequestLedger || !returnFailedRequestAmount || !returnFailedRequestRecipient) {
      setError('Please fill in all fields');
      return;
    }
    
    try {
      setLoading(true);
      setError('');
      setSuccess('');
      const actor = getSneedLockActor();
      if (!actor) throw new Error('Failed to create actor');

      const ledgerPrincipal = Principal.fromText(returnFailedRequestLedger);
      const recipientPrincipal = Principal.fromText(returnFailedRequestRecipient);
      const amount = BigInt(returnFailedRequestAmount);

      const result = await actor.admin_return_token_from_failed_request(
        ledgerPrincipal, 
        amount, 
        recipientPrincipal
      );
      
      if ('Ok' in result) {
        setSuccess(`Token returned from failed request. Transfer index: ${result.Ok}`);
        setReturnFailedRequestLedger('');
        setReturnFailedRequestAmount('');
        setReturnFailedRequestRecipient('');
      } else {
        setError(`Failed to return token: ${JSON.stringify(result.Err)}`);
      }
    } catch (err) {
      console.error('Error returning token from failed request:', err);
      setError('Failed to return token: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  const refreshClaimRequests = async () => {
    try {
      const actor = getSneedLockActor();
      if (!actor) return;
      
      const [activeReqs, completedReqs, failedReqs] = await Promise.all([
        actor.get_all_active_claim_requests(),
        actor.get_all_completed_claim_requests(),
        actor.get_all_failed_claim_requests()
      ]);
      
      setActiveClaimRequests(activeReqs);
      setCompletedClaimRequests(completedReqs);
      setFailedClaimRequests(failedReqs);
    } catch (err) {
      console.error('Error refreshing claim requests:', err);
    }
  };

  const handleRemoveAdmin = async (e) => {
    e.preventDefault();
    if (!removeAdminPrincipal) {
      setError('Please provide an admin principal to remove');
      return;
    }
    
    if (!window.confirm(`Are you sure you want to remove admin: ${removeAdminPrincipal}?`)) {
      return;
    }
    
    try {
      setLoading(true);
      setError('');
      setSuccess('');
      const actor = getSneedLockActor();
      if (!actor) throw new Error('Failed to create actor');

      const adminPrincipal = Principal.fromText(removeAdminPrincipal);
      const result = await actor.admin_remove_admin(adminPrincipal);
      
      if ('Ok' in result) {
        setSuccess(`Admin removed: ${result.Ok}`);
        setRemoveAdminPrincipal('');
        
        // Refresh admin list
        const admins = await actor.get_admin_list();
        setAdminList(admins);
      } else {
        setError(`Failed to remove admin: ${result.Err}`);
      }
    } catch (err) {
      console.error('Error removing admin:', err);
      setError('Failed to remove admin: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleUpdateIcpFees = async (e) => {
    e.preventDefault();
    try {
      setLoading(true);
      setError('');
      setSuccess('');
      const actor = getSneedLockActor();
      if (!actor) throw new Error('Failed to create actor');

      const result = await actor.admin_set_lock_fees_icp(
        tokenLockFeeIcp ? [BigInt(tokenLockFeeIcp)] : [],
        positionLockFeeIcp ? [BigInt(positionLockFeeIcp)] : [],
        premiumTokenLockFeeIcp ? [BigInt(premiumTokenLockFeeIcp)] : [],
        premiumPositionLockFeeIcp ? [BigInt(premiumPositionLockFeeIcp)] : []
      );
      
      if ('Ok' in result) {
        setSuccess(`ICP lock fees updated successfully`);
        // Refresh fee config
        const icpFees = await actor.get_lock_fees_icp();
        setIcpFeeConfig(icpFees);
      } else {
        setError(`Failed to update ICP fees: ${result.Err}`);
      }
    } catch (err) {
      console.error('Error updating ICP fees:', err);
      setError('Failed to update ICP fees: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleSetPremiumCanister = async (e) => {
    e.preventDefault();
    try {
      setLoading(true);
      setError('');
      setSuccess('');
      const actor = getSneedLockActor();
      if (!actor) throw new Error('Failed to create actor');

      let canisterIdArg = [];
      if (premiumCanisterId && premiumCanisterId.trim()) {
        canisterIdArg = [Principal.fromText(premiumCanisterId.trim())];
      }
      
      const result = await actor.admin_set_sneed_premium_canister_id(canisterIdArg);
      
      if ('Ok' in result) {
        setSuccess(result.Ok);
        // Refresh fee config
        const icpFees = await actor.get_lock_fees_icp();
        setIcpFeeConfig(icpFees);
      } else {
        setError(`Failed to set premium canister: ${result.Err}`);
      }
    } catch (err) {
      console.error('Error setting premium canister:', err);
      setError('Failed to set premium canister: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  const formatIcpFee = (e8s) => {
    const icp = Number(e8s) / 100_000_000;
    return `${icp.toFixed(4)} ICP (${e8s} e8s)`;
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

  const getStatusColor = (status) => {
    if ('Pending' in status) return '#3498db';
    if ('Processing' in status) return '#f39c12';
    if ('BalanceRecorded' in status) return '#9b59b6';
    if ('ClaimAttempted' in status) return '#e67e22';
    if ('ClaimVerified' in status) return '#1abc9c';
    if ('Withdrawn' in status) return '#2ecc71';
    if ('Completed' in status) return '#27ae60';
    if ('Failed' in status) return '#e74c3c';
    if ('TimedOut' in status) return '#c0392b';
    return '#888';
  };

  const getStatusText = (status) => {
    if ('Pending' in status) return 'Pending';
    if ('Processing' in status) return 'Processing';
    if ('BalanceRecorded' in status) return 'Balance Recorded';
    if ('ClaimAttempted' in status) return `Claim Attempted (${status.ClaimAttempted.claim_attempt})`;
    if ('ClaimVerified' in status) return 'Claim Verified';
    if ('Withdrawn' in status) return 'Withdrawn';
    if ('Completed' in status) {
      const c = status.Completed;
      return `Completed (Claimed: ${Number(c.amount0_claimed)}/${Number(c.amount1_claimed)}, Transferred: ${Number(c.amount0_transferred)}/${Number(c.amount1_transferred)})`;
    }
    if ('Failed' in status) return `Failed: ${status.Failed}`;
    if ('TimedOut' in status) return 'Timed Out';
    return JSON.stringify(status);
  };

  const renderStatusDetails = (status) => {
    if (!('Completed' in status)) return null;
    
    const c = status.Completed;
    const hasTxId0 = c.transfer0_tx_id && c.transfer0_tx_id.length > 0;
    const hasTxId1 = c.transfer1_tx_id && c.transfer1_tx_id.length > 0;
    
    return (
      <div style={{ marginTop: '10px', fontSize: '11px', color: '#888', lineHeight: '1.6' }}>
        <div><strong>Token 0:</strong> Claimed: {Number(c.amount0_claimed)}, Transferred: {Number(c.amount0_transferred)}
          {hasTxId0 && <span style={{ color: '#3498db' }}> (TX: {Number(c.transfer0_tx_id[0])})</span>}
        </div>
        <div><strong>Token 1:</strong> Claimed: {Number(c.amount1_claimed)}, Transferred: {Number(c.amount1_transferred)}
          {hasTxId1 && <span style={{ color: '#3498db' }}> (TX: {Number(c.transfer1_tx_id[0])})</span>}
        </div>
      </div>
    );
  };

  const renderClaimRequestCard = (request) => (
    <div
      key={request.request_id.toString()}
      style={{
        backgroundColor: '#2a2a2a',
        borderRadius: '4px',
        padding: '15px',
        border: `1px solid ${getStatusColor(request.status)}`,
        marginBottom: '10px'
      }}
    >
      <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr auto', gap: '15px', alignItems: 'start' }}>
        <div>
          <div style={{ color: '#888', fontSize: '12px', marginBottom: '4px' }}>Request ID</div>
          <div style={{ color: '#3498db', fontSize: '18px', fontWeight: 'bold' }}>
            {Number(request.request_id)}
          </div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '10px' }}>
          <div>
            <div style={{ color: '#888', fontSize: '11px' }}>Status</div>
            <div style={{ color: getStatusColor(request.status), fontSize: '13px', fontWeight: 'bold' }}>
              {getStatusText(request.status)}
            </div>
          </div>
          <div>
            <div style={{ color: '#888', fontSize: '11px' }}>Caller</div>
            <div style={{ color: '#ffffff', fontSize: '12px', fontFamily: 'monospace' }}>
              {formatPrincipal(request.caller)}
            </div>
          </div>
          <div>
            <div style={{ color: '#888', fontSize: '11px' }}>Position ID</div>
            <div style={{ color: '#ffffff', fontSize: '13px' }}>{Number(request.position_id)}</div>
          </div>
          <div>
            <div style={{ color: '#888', fontSize: '11px' }}>Swap Canister</div>
            <div style={{ color: '#ffffff', fontSize: '12px', fontFamily: 'monospace' }}>
              {formatPrincipal(request.swap_canister_id)}
            </div>
          </div>
          <div>
            <div style={{ color: '#888', fontSize: '11px' }}>Created</div>
            <div style={{ color: '#ffffff', fontSize: '12px' }}>
              {formatTimestamp(request.created_at)}
            </div>
          </div>
          {request.last_attempted_at.length > 0 && (
            <div>
              <div style={{ color: '#888', fontSize: '11px' }}>Last Attempted</div>
              <div style={{ color: '#ffffff', fontSize: '12px' }}>
                {formatTimestamp(request.last_attempted_at[0])}
              </div>
            </div>
          )}
          <div>
            <div style={{ color: '#888', fontSize: '11px' }}>Retry Count</div>
            <div style={{ color: '#ffffff', fontSize: '13px' }}>{Number(request.retry_count)}</div>
          </div>
        </div>
        <div style={{ display: 'flex', gap: '5px', flexDirection: 'column' }}>
          <button
            onClick={() => {
              setRetryRequestId(request.request_id.toString());
              handleRetryRequest({ preventDefault: () => {} });
            }}
            style={{
              backgroundColor: '#f39c12',
              color: '#ffffff',
              border: 'none',
              borderRadius: '4px',
              padding: '6px 12px',
              fontSize: '12px',
              cursor: 'pointer'
            }}
          >
            Retry
          </button>
          <button
            onClick={() => {
              setRemoveRequestId(request.request_id.toString());
              handleRemoveClaimRequest({ preventDefault: () => {} });
            }}
            style={{
              backgroundColor: '#e74c3c',
              color: '#ffffff',
              border: 'none',
              borderRadius: '4px',
              padding: '6px 12px',
              fontSize: '12px',
              cursor: 'pointer'
            }}
          >
            Remove
          </button>
        </div>
      </div>
      {renderStatusDetails(request.status)}
    </div>
  );

  const renderActiveClaimRequests = () => (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
        <h2 style={{ color: '#ffffff', fontSize: '24px' }}>Active Claim Requests</h2>
        <button
          onClick={refreshClaimRequests}
          style={{
            backgroundColor: '#3498db',
            color: '#ffffff',
            border: 'none',
            borderRadius: '4px',
            padding: '8px 16px',
            cursor: 'pointer'
          }}
        >
          Refresh
        </button>
      </div>
      
      <div style={{ backgroundColor: '#1a1a1a', borderRadius: '8px', padding: '20px', border: '1px solid #3a3a3a' }}>
        {activeClaimRequests.length === 0 ? (
          <div style={{ color: '#888', textAlign: 'center', padding: '20px' }}>No active claim requests</div>
        ) : (
          activeClaimRequests.map(request => renderClaimRequestCard(request))
        )}
      </div>
    </div>
  );

  const renderCompletedClaimRequests = () => (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
        <h2 style={{ color: '#ffffff', fontSize: '24px' }}>Completed Claim Requests</h2>
        <div style={{ display: 'flex', gap: '10px' }}>
          <button
            onClick={handleClearCompletedRequests}
            style={{
              backgroundColor: '#e74c3c',
              color: '#ffffff',
              border: 'none',
              borderRadius: '4px',
              padding: '8px 16px',
              cursor: 'pointer'
            }}
          >
            Clear All
          </button>
          <button
            onClick={refreshClaimRequests}
            style={{
              backgroundColor: '#3498db',
              color: '#ffffff',
              border: 'none',
              borderRadius: '4px',
              padding: '8px 16px',
              cursor: 'pointer'
            }}
          >
            Refresh
          </button>
        </div>
      </div>
      
      <div style={{ backgroundColor: '#1a1a1a', borderRadius: '8px', padding: '20px', border: '1px solid #3a3a3a' }}>
        {completedClaimRequests.length === 0 ? (
          <div style={{ color: '#888', textAlign: 'center', padding: '20px' }}>No completed claim requests</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {completedClaimRequests.map((request) => (
              <div
                key={request.request_id.toString()}
                style={{
                  backgroundColor: 'rgba(46, 204, 113, 0.1)',
                  borderRadius: '4px',
                  padding: '15px',
                  border: '1px solid #2ecc71'
                }}
              >
                <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '15px', alignItems: 'start' }}>
                  <div>
                    <div style={{ color: '#888', fontSize: '12px', marginBottom: '4px' }}>Request ID</div>
                    <div style={{ color: '#2ecc71', fontSize: '18px', fontWeight: 'bold' }}>
                      {Number(request.request_id)}
                    </div>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '10px' }}>
                    <div>
                      <div style={{ color: '#888', fontSize: '11px' }}>Status</div>
                      <div style={{ color: '#2ecc71', fontSize: '13px', fontWeight: 'bold' }}>
                        {getStatusText(request.status)}
                      </div>
                    </div>
                    <div>
                      <div style={{ color: '#888', fontSize: '11px' }}>Caller</div>
                      <div style={{ color: '#ffffff', fontSize: '12px', fontFamily: 'monospace' }}>
                        {formatPrincipal(request.caller)}
                      </div>
                    </div>
                    <div>
                      <div style={{ color: '#888', fontSize: '11px' }}>Position ID</div>
                      <div style={{ color: '#ffffff', fontSize: '13px' }}>{Number(request.position_id)}</div>
                    </div>
                    <div>
                      <div style={{ color: '#888', fontSize: '11px' }}>Swap Canister</div>
                      <div style={{ color: '#ffffff', fontSize: '12px', fontFamily: 'monospace' }}>
                        {formatPrincipal(request.swap_canister_id)}
                      </div>
                    </div>
                    <div>
                      <div style={{ color: '#888', fontSize: '11px' }}>Created</div>
                      <div style={{ color: '#ffffff', fontSize: '12px' }}>
                        {formatTimestamp(request.created_at)}
                      </div>
                    </div>
                    {request.completed_at.length > 0 && (
                      <div>
                        <div style={{ color: '#888', fontSize: '11px' }}>Completed</div>
                        <div style={{ color: '#ffffff', fontSize: '12px' }}>
                          {formatTimestamp(request.completed_at[0])}
                        </div>
                      </div>
                    )}
                    <div>
                      <div style={{ color: '#888', fontSize: '11px' }}>Retry Count</div>
                      <div style={{ color: '#ffffff', fontSize: '13px' }}>{Number(request.retry_count)}</div>
                    </div>
                  </div>
                </div>
                {renderStatusDetails(request.status)}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );

  const renderFailedClaimRequests = () => (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
        <h2 style={{ color: '#ffffff', fontSize: '24px' }}>Failed Claim Requests</h2>
        <div style={{ display: 'flex', gap: '10px' }}>
          <button
            onClick={handleClearFailedRequests}
            style={{
              backgroundColor: '#e74c3c',
              color: '#ffffff',
              border: 'none',
              borderRadius: '4px',
              padding: '8px 16px',
              cursor: 'pointer'
            }}
          >
            Clear All
          </button>
          <button
            onClick={refreshClaimRequests}
            style={{
              backgroundColor: '#3498db',
              color: '#ffffff',
              border: 'none',
              borderRadius: '4px',
              padding: '8px 16px',
              cursor: 'pointer'
            }}
          >
            Refresh
          </button>
        </div>
      </div>
      
      <div style={{ backgroundColor: '#1a1a1a', borderRadius: '8px', padding: '20px', border: '1px solid #3a3a3a' }}>
        {failedClaimRequests.length === 0 ? (
          <div style={{ color: '#888', textAlign: 'center', padding: '20px' }}>No failed claim requests</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {failedClaimRequests.map((request) => (
              <div
                key={request.request_id.toString()}
                style={{
                  backgroundColor: 'rgba(231, 76, 60, 0.1)',
                  borderRadius: '4px',
                  padding: '15px',
                  border: '1px solid #e74c3c'
                }}
              >
                <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr auto', gap: '15px', alignItems: 'start' }}>
                  <div>
                    <div style={{ color: '#888', fontSize: '12px', marginBottom: '4px' }}>Request ID</div>
                    <div style={{ color: '#e74c3c', fontSize: '18px', fontWeight: 'bold' }}>
                      {Number(request.request_id)}
                    </div>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '10px' }}>
                    <div>
                      <div style={{ color: '#888', fontSize: '11px' }}>Status</div>
                      <div style={{ color: '#e74c3c', fontSize: '13px', fontWeight: 'bold' }}>
                        {getStatusText(request.status)}
                      </div>
                    </div>
                    <div>
                      <div style={{ color: '#888', fontSize: '11px' }}>Caller</div>
                      <div style={{ color: '#ffffff', fontSize: '12px', fontFamily: 'monospace' }}>
                        {formatPrincipal(request.caller)}
                      </div>
                    </div>
                    <div>
                      <div style={{ color: '#888', fontSize: '11px' }}>Position ID</div>
                      <div style={{ color: '#ffffff', fontSize: '13px' }}>{Number(request.position_id)}</div>
                    </div>
                    <div>
                      <div style={{ color: '#888', fontSize: '11px' }}>Swap Canister</div>
                      <div style={{ color: '#ffffff', fontSize: '12px', fontFamily: 'monospace' }}>
                        {formatPrincipal(request.swap_canister_id)}
                      </div>
                    </div>
                    <div>
                      <div style={{ color: '#888', fontSize: '11px' }}>Created</div>
                      <div style={{ color: '#ffffff', fontSize: '12px' }}>
                        {formatTimestamp(request.created_at)}
                      </div>
                    </div>
                    {request.last_attempted_at.length > 0 && (
                      <div>
                        <div style={{ color: '#888', fontSize: '11px' }}>Last Attempted</div>
                        <div style={{ color: '#ffffff', fontSize: '12px' }}>
                          {formatTimestamp(request.last_attempted_at[0])}
                        </div>
                      </div>
                    )}
                    <div>
                      <div style={{ color: '#888', fontSize: '11px' }}>Retry Count</div>
                      <div style={{ color: '#ffffff', fontSize: '13px' }}>{Number(request.retry_count)}</div>
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: '5px', flexDirection: 'column' }}>
                    <button
                      onClick={() => {
                        setRetryRequestId(request.request_id.toString());
                        handleRetryRequest({ preventDefault: () => {} });
                      }}
                      style={{
                        backgroundColor: '#f39c12',
                        color: '#ffffff',
                        border: 'none',
                        borderRadius: '4px',
                        padding: '6px 12px',
                        fontSize: '12px',
                        cursor: 'pointer'
                      }}
                    >
                      Retry
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );

  const renderTimerStatus = () => (
    <div>
      <h2 style={{ color: '#ffffff', fontSize: '24px', marginBottom: '20px' }}>Timer Status</h2>
      
      {timerStatus && (
        <div style={{
          backgroundColor: '#2a2a2a',
          borderRadius: '8px',
          padding: '20px',
          marginBottom: '20px',
          border: '1px solid #3a3a3a'
        }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: '20px' }}>
            <div>
              <div style={{ color: '#888', fontSize: '12px', marginBottom: '5px' }}>Timer Active</div>
              <div style={{ 
                color: timerStatus.is_active ? '#2ecc71' : '#e74c3c', 
                fontSize: '20px',
                fontWeight: 'bold'
              }}>
                {timerStatus.is_active ? 'ACTIVE' : 'STOPPED'}
              </div>
            </div>
            
            {timerStatus.timer_id.length > 0 && (
              <div>
                <div style={{ color: '#888', fontSize: '12px', marginBottom: '5px' }}>Timer ID</div>
                <div style={{ color: '#ffffff', fontSize: '16px' }}>{Number(timerStatus.timer_id[0])}</div>
              </div>
            )}
            
            {timerStatus.last_execution_time.length > 0 && (
              <div>
                <div style={{ color: '#888', fontSize: '12px', marginBottom: '5px' }}>Last Execution</div>
                <div style={{ color: '#ffffff', fontSize: '14px' }}>
                  {formatTimestamp(timerStatus.last_execution_time[0])}
                </div>
              </div>
            )}
            
            {timerStatus.time_since_last_execution_seconds.length > 0 && (
              <div>
                <div style={{ color: '#888', fontSize: '12px', marginBottom: '5px' }}>Time Since Last</div>
                <div style={{ color: '#ffffff', fontSize: '16px' }}>
                  {Number(timerStatus.time_since_last_execution_seconds[0])} seconds
                </div>
              </div>
            )}
            
            {timerStatus.next_scheduled_time.length > 0 && (
              <div>
                <div style={{ color: '#888', fontSize: '12px', marginBottom: '5px' }}>Next Scheduled</div>
                <div style={{ color: '#ffffff', fontSize: '14px' }}>
                  {formatTimestamp(timerStatus.next_scheduled_time[0])}
                </div>
              </div>
            )}
            
            {timerStatus.last_execution_correlation_id.length > 0 && (
              <div>
                <div style={{ color: '#888', fontSize: '12px', marginBottom: '5px' }}>Last Correlation ID</div>
                <div style={{ color: '#ffffff', fontSize: '16px' }}>
                  {Number(timerStatus.last_execution_correlation_id[0])}
                </div>
              </div>
            )}
          </div>
          
          <div style={{ marginTop: '20px', display: 'flex', gap: '10px' }}>
            <button
              onClick={handleTriggerProcessing}
              disabled={loading}
              style={{
                backgroundColor: '#3498db',
                color: '#ffffff',
                border: 'none',
                borderRadius: '4px',
                padding: '10px 20px',
                cursor: loading ? 'not-allowed' : 'pointer',
                opacity: loading ? 0.6 : 1
              }}
            >
              Trigger Processing Now
            </button>
            <button
              onClick={handleEmergencyStopTimer}
              disabled={loading || !timerStatus.is_active}
              style={{
                backgroundColor: '#e74c3c',
                color: '#ffffff',
                border: 'none',
                borderRadius: '4px',
                padding: '10px 20px',
                cursor: (loading || !timerStatus.is_active) ? 'not-allowed' : 'pointer',
                opacity: (loading || !timerStatus.is_active) ? 0.6 : 1
              }}
            >
              Emergency Stop Timer
            </button>
          </div>
        </div>
      )}
    </div>
  );

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
              <div style={{ color: '#888', fontSize: '12px' }}>Currently Processing</div>
              <div style={{ color: claimQueueStatus.is_currently_processing ? '#f39c12' : '#888', fontSize: '16px', fontWeight: claimQueueStatus.is_currently_processing ? 'bold' : 'normal' }}>
                {claimQueueStatus.is_currently_processing ? 'YES' : 'NO'}
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
              <div style={{ color: '#888', fontSize: '12px' }}>Completed</div>
              <div style={{ color: '#2ecc71', fontSize: '16px', fontWeight: 'bold' }}>{Number(claimQueueStatus.completed_count)}</div>
            </div>
            <div>
              <div style={{ color: '#888', fontSize: '12px' }}>Failed</div>
              <div style={{ color: '#e74c3c', fontSize: '16px', fontWeight: 'bold' }}>{Number(claimQueueStatus.failed_count)}</div>
            </div>
            <div>
              <div style={{ color: '#888', fontSize: '12px' }}>Consecutive Empty Cycles</div>
              <div style={{ color: '#ffffff', fontSize: '16px' }}>{Number(claimQueueStatus.consecutive_empty_cycles)}</div>
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

      {/* Retry Claim Request */}
      <div style={{
        backgroundColor: '#2a2a2a',
        borderRadius: '8px',
        padding: '20px',
        marginBottom: '20px',
        border: '1px solid #3a3a3a'
      }}>
        <h3 style={{ color: '#ffffff', fontSize: '18px', marginBottom: '15px' }}>Retry Claim Request</h3>
        <p style={{ color: '#888', fontSize: '13px', marginBottom: '15px' }}>
          Retry a failed or stuck claim request. This will reset its state and attempt processing again.
        </p>
        <form onSubmit={handleRetryRequest} style={{ display: 'flex', gap: '10px', alignItems: 'flex-end' }}>
          <div style={{ flex: 1 }}>
            <label style={{ color: '#888', fontSize: '12px', display: 'block', marginBottom: '5px' }}>
              Request ID
            </label>
            <input
              type="text"
              placeholder="Enter request ID"
              value={retryRequestId}
              onChange={(e) => setRetryRequestId(e.target.value)}
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
              backgroundColor: '#f39c12',
              color: '#ffffff',
              border: 'none',
              borderRadius: '4px',
              padding: '10px 20px',
              cursor: 'pointer'
            }}
          >
            Retry Request
          </button>
        </form>
      </div>

      {/* Rescue Stuck Tokens */}
      <div style={{
        backgroundColor: '#2a2a2a',
        borderRadius: '8px',
        padding: '20px',
        marginBottom: '20px',
        border: '1px solid #3a3a3a'
      }}>
        <h3 style={{ color: '#ffffff', fontSize: '18px', marginBottom: '15px' }}>Rescue Stuck Tokens</h3>
        <p style={{ color: '#888', fontSize: '13px', marginBottom: '15px' }}>
          Rescue all tokens of a specific type that are stuck in the canister's main account.
        </p>
        <form onSubmit={handleRescueStuckTokens}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '15px' }}>
            <div>
              <label style={{ color: '#888', fontSize: '12px', display: 'block', marginBottom: '5px' }}>
                Token Ledger Canister ID
              </label>
              <input
                type="text"
                placeholder="Principal of ICRC-1 ledger"
                value={rescueTokenLedger}
                onChange={(e) => setRescueTokenLedger(e.target.value)}
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
                Recipient Principal
              </label>
              <input
                type="text"
                placeholder="Principal to receive tokens"
                value={rescueTokenRecipient}
                onChange={(e) => setRescueTokenRecipient(e.target.value)}
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
              backgroundColor: '#e67e22',
              color: '#ffffff',
              border: 'none',
              borderRadius: '4px',
              padding: '10px 20px',
              marginTop: '15px',
              cursor: 'pointer'
            }}
          >
            Rescue Tokens
          </button>
        </form>
      </div>

      {/* Return Token from Failed Request */}
      <div style={{
        backgroundColor: '#2a2a2a',
        borderRadius: '8px',
        padding: '20px',
        marginBottom: '20px',
        border: '1px solid #3a3a3a'
      }}>
        <h3 style={{ color: '#ffffff', fontSize: '18px', marginBottom: '15px' }}>Return Token from Failed Request</h3>
        <p style={{ color: '#888', fontSize: '13px', marginBottom: '15px' }}>
          Return tokens from a failed claim request to a specific recipient.
        </p>
        <form onSubmit={handleReturnTokenFromFailedRequest}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '15px' }}>
            <div>
              <label style={{ color: '#888', fontSize: '12px', display: 'block', marginBottom: '5px' }}>
                Ledger Canister ID
              </label>
              <input
                type="text"
                placeholder="Principal of ICRC-1 ledger"
                value={returnFailedRequestLedger}
                onChange={(e) => setReturnFailedRequestLedger(e.target.value)}
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
                value={returnFailedRequestAmount}
                onChange={(e) => setReturnFailedRequestAmount(e.target.value)}
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
                Recipient Principal
              </label>
              <input
                type="text"
                placeholder="Principal to return tokens to"
                value={returnFailedRequestRecipient}
                onChange={(e) => setReturnFailedRequestRecipient(e.target.value)}
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
      
      {/* Admin List */}
      <div style={{
        backgroundColor: '#2a2a2a',
        borderRadius: '8px',
        padding: '20px',
        marginBottom: '20px',
        border: '1px solid #3a3a3a'
      }}>
        <h3 style={{ color: '#ffffff', fontSize: '18px', marginBottom: '15px' }}>SneedLock Admins</h3>
        <p style={{ color: '#888', fontSize: '14px', marginBottom: '15px' }}>
          Current admins with access to SneedLock admin functions ({adminList.length} total):
        </p>
        <div style={{ 
          backgroundColor: '#1a1a1a', 
          borderRadius: '4px', 
          padding: '15px',
          marginBottom: '15px',
          maxHeight: '300px',
          overflowY: 'auto'
        }}>
          {adminList.length === 0 ? (
            <div style={{ color: '#888', textAlign: 'center' }}>No admins found</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {adminList.map((admin, idx) => (
                <div
                  key={idx}
                  style={{
                    backgroundColor: '#2a2a2a',
                    padding: '10px',
                    borderRadius: '4px',
                    fontFamily: 'monospace',
                    fontSize: '13px',
                    color: '#3498db',
                    wordBreak: 'break-all'
                  }}
                >
                  {admin.toString()}
                </div>
              ))}
            </div>
          )}
        </div>
        
        {/* Add Admin Form */}
        <form onSubmit={handleAddAdmin} style={{ marginTop: '15px' }}>
          <div style={{ display: 'flex', gap: '10px', alignItems: 'flex-end' }}>
            <div style={{ flex: 1 }}>
              <label style={{ color: '#888', fontSize: '12px', display: 'block', marginBottom: '5px' }}>
                Add Admin by Principal
              </label>
              <input
                type="text"
                placeholder="Enter principal to add"
                value={addAdminPrincipal}
                onChange={(e) => setAddAdminPrincipal(e.target.value)}
                style={{
                  width: '100%',
                  padding: '10px',
                  borderRadius: '4px',
                  border: '1px solid #3a3a3a',
                  backgroundColor: '#1a1a1a',
                  color: '#ffffff',
                  fontFamily: 'monospace'
                }}
              />
            </div>
            <button
              type="submit"
              style={{
                backgroundColor: '#2ecc71',
                color: '#ffffff',
                border: 'none',
                borderRadius: '4px',
                padding: '10px 20px',
                cursor: 'pointer',
                whiteSpace: 'nowrap'
              }}
            >
              Add Admin
            </button>
          </div>
        </form>

        {/* Remove Admin Form */}
        <form onSubmit={handleRemoveAdmin} style={{ marginTop: '15px' }}>
          <div style={{ display: 'flex', gap: '10px', alignItems: 'flex-end' }}>
            <div style={{ flex: 1 }}>
              <label style={{ color: '#888', fontSize: '12px', display: 'block', marginBottom: '5px' }}>
                Remove Admin by Principal
              </label>
              <input
                type="text"
                placeholder="Enter principal to remove"
                value={removeAdminPrincipal}
                onChange={(e) => setRemoveAdminPrincipal(e.target.value)}
                style={{
                  width: '100%',
                  padding: '10px',
                  borderRadius: '4px',
                  border: '1px solid #3a3a3a',
                  backgroundColor: '#1a1a1a',
                  color: '#ffffff',
                  fontFamily: 'monospace'
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
                cursor: 'pointer',
                whiteSpace: 'nowrap'
              }}
            >
              Remove Admin
            </button>
          </div>
          <p style={{ color: '#888', fontSize: '11px', marginTop: '8px' }}>
            ⚠️ Warning: Removing an admin cannot be undone from this interface
          </p>
        </form>
      </div>
      
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

      {/* Premium Integration */}
      <div style={{
        backgroundColor: '#2a2a2a',
        borderRadius: '8px',
        padding: '20px',
        marginBottom: '20px',
        border: '1px solid #3a3a3a'
      }}>
        <h3 style={{ color: '#ffffff', fontSize: '18px', marginBottom: '15px' }}>🔶 Sneed Premium Integration</h3>
        <p style={{ color: '#888', fontSize: '14px', marginBottom: '15px' }}>
          Configure the Sneed Premium canister ID for premium pricing tiers.
        </p>
        
        {icpFeeConfig && (
          <div style={{ marginBottom: '15px', padding: '10px', backgroundColor: '#1a1a1a', borderRadius: '4px' }}>
            <p style={{ color: '#888', fontSize: '13px' }}>
              Current: {icpFeeConfig.sneed_premium_canister_id && icpFeeConfig.sneed_premium_canister_id.length > 0 
                ? <span style={{ color: '#2ecc71', fontFamily: 'monospace' }}>{icpFeeConfig.sneed_premium_canister_id[0].toString()}</span>
                : <span style={{ color: '#e74c3c' }}>Not configured</span>}
            </p>
          </div>
        )}
        
        <form onSubmit={handleSetPremiumCanister}>
          <div style={{ display: 'flex', gap: '10px', alignItems: 'flex-end' }}>
            <div style={{ flex: 1 }}>
              <label style={{ color: '#888', fontSize: '12px', display: 'block', marginBottom: '5px' }}>
                Sneed Premium Canister ID (leave empty to clear)
              </label>
              <input
                type="text"
                placeholder="e.g., xxxxx-xxxxx-xxxxx-xxxxx-cai"
                value={premiumCanisterId}
                onChange={(e) => setPremiumCanisterId(e.target.value)}
                style={{
                  width: '100%',
                  padding: '10px',
                  borderRadius: '4px',
                  border: '1px solid #3a3a3a',
                  backgroundColor: '#1a1a1a',
                  color: '#ffffff',
                  fontFamily: 'monospace'
                }}
              />
            </div>
            <button
              type="submit"
              disabled={loading}
              style={{
                backgroundColor: '#f39c12',
                color: '#ffffff',
                border: 'none',
                borderRadius: '4px',
                padding: '10px 20px',
                cursor: loading ? 'not-allowed' : 'pointer',
                opacity: loading ? 0.6 : 1,
                whiteSpace: 'nowrap'
              }}
            >
              Set Premium Canister
            </button>
          </div>
        </form>
      </div>

      {/* ICP Lock Fees */}
      <div style={{
        backgroundColor: '#2a2a2a',
        borderRadius: '8px',
        padding: '20px',
        marginBottom: '20px',
        border: '1px solid #3a3a3a'
      }}>
        <h3 style={{ color: '#ffffff', fontSize: '18px', marginBottom: '15px' }}>💰 ICP Lock Fees</h3>
        <p style={{ color: '#888', fontSize: '14px', marginBottom: '15px' }}>
          Configure ICP fees for creating locks. Users must send ICP to their payment subaccount before creating a lock.
          Set to 0 for free locks.
        </p>
        
        {icpFeeConfig && (
          <div style={{ 
            display: 'grid', 
            gridTemplateColumns: 'repeat(2, 1fr)', 
            gap: '15px', 
            marginBottom: '20px',
            padding: '15px',
            backgroundColor: '#1a1a1a',
            borderRadius: '8px'
          }}>
            <div>
              <p style={{ color: '#888', fontSize: '12px', marginBottom: '4px' }}>Token Lock Fee (Regular)</p>
              <p style={{ color: '#ffffff', fontSize: '14px', fontWeight: 'bold' }}>
                {formatIcpFee(icpFeeConfig.token_lock_fee_icp_e8s)}
              </p>
            </div>
            <div>
              <p style={{ color: '#888', fontSize: '12px', marginBottom: '4px' }}>Position Lock Fee (Regular)</p>
              <p style={{ color: '#ffffff', fontSize: '14px', fontWeight: 'bold' }}>
                {formatIcpFee(icpFeeConfig.position_lock_fee_icp_e8s)}
              </p>
            </div>
            <div>
              <p style={{ color: '#FFD700', fontSize: '12px', marginBottom: '4px' }}>⭐ Token Lock Fee (Premium)</p>
              <p style={{ color: '#FFD700', fontSize: '14px', fontWeight: 'bold' }}>
                {formatIcpFee(icpFeeConfig.premium_token_lock_fee_icp_e8s)}
              </p>
            </div>
            <div>
              <p style={{ color: '#FFD700', fontSize: '12px', marginBottom: '4px' }}>⭐ Position Lock Fee (Premium)</p>
              <p style={{ color: '#FFD700', fontSize: '14px', fontWeight: 'bold' }}>
                {formatIcpFee(icpFeeConfig.premium_position_lock_fee_icp_e8s)}
              </p>
            </div>
          </div>
        )}
        
        <form onSubmit={handleUpdateIcpFees}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '15px', marginBottom: '15px' }}>
            <div>
              <label style={{ color: '#888', fontSize: '12px', display: 'block', marginBottom: '5px' }}>
                Token Lock Fee (e8s)
              </label>
              <input
                type="number"
                placeholder="0"
                value={tokenLockFeeIcp}
                onChange={(e) => setTokenLockFeeIcp(e.target.value)}
                style={{
                  width: '100%',
                  padding: '10px',
                  borderRadius: '4px',
                  border: '1px solid #3a3a3a',
                  backgroundColor: '#1a1a1a',
                  color: '#ffffff'
                }}
              />
              <p style={{ color: '#666', fontSize: '11px', marginTop: '4px' }}>
                100,000,000 e8s = 1 ICP
              </p>
            </div>
            <div>
              <label style={{ color: '#888', fontSize: '12px', display: 'block', marginBottom: '5px' }}>
                Position Lock Fee (e8s)
              </label>
              <input
                type="number"
                placeholder="0"
                value={positionLockFeeIcp}
                onChange={(e) => setPositionLockFeeIcp(e.target.value)}
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
              <label style={{ color: '#FFD700', fontSize: '12px', display: 'block', marginBottom: '5px' }}>
                ⭐ Premium Token Lock Fee (e8s)
              </label>
              <input
                type="number"
                placeholder="0"
                value={premiumTokenLockFeeIcp}
                onChange={(e) => setPremiumTokenLockFeeIcp(e.target.value)}
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
              <label style={{ color: '#FFD700', fontSize: '12px', display: 'block', marginBottom: '5px' }}>
                ⭐ Premium Position Lock Fee (e8s)
              </label>
              <input
                type="number"
                placeholder="0"
                value={premiumPositionLockFeeIcp}
                onChange={(e) => setPremiumPositionLockFeeIcp(e.target.value)}
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
            disabled={loading}
            style={{
              backgroundColor: '#3498db',
              color: '#ffffff',
              border: 'none',
              borderRadius: '4px',
              padding: '10px 20px',
              cursor: loading ? 'not-allowed' : 'pointer',
              opacity: loading ? 0.6 : 1
            }}
          >
            Update ICP Fees
          </button>
        </form>
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
          paddingBottom: '10px',
          flexWrap: 'wrap'
        }}>
          {['queue', 'completed', 'failed', 'timer', 'info', 'error', 'functions', 'settings'].map(tab => (
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
              {tab === 'queue' && 'Active Queue'}
              {tab === 'completed' && 'Completed'}
              {tab === 'failed' && 'Failed'}
              {tab === 'timer' && 'Timer Status'}
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
            {activeTab === 'queue' && renderActiveClaimRequests()}
            {activeTab === 'completed' && renderCompletedClaimRequests()}
            {activeTab === 'failed' && renderFailedClaimRequests()}
            {activeTab === 'timer' && renderTimerStatus()}
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

