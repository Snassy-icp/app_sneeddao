import React, { useState, useEffect } from 'react';
import { useAuth } from '../../AuthContext';
import { useAdminCheck } from '../../hooks/useAdminCheck';
import { createActor as createFactoryActor, canisterId as factoryCanisterId } from 'declarations/sneed_icp_neuron_manager_factory';
import Header from '../../components/Header';
import { Principal } from '@dfinity/principal';

const E8S = 100_000_000;

export default function IcpNeuronManagerFactoryAdmin() {
  const { isAuthenticated, identity } = useAuth();
  const [activeTab, setActiveTab] = useState('config');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  
  // Payment config state
  const [paymentConfig, setPaymentConfig] = useState(null);
  const [creationFee, setCreationFee] = useState('');
  const [targetCycles, setTargetCycles] = useState('');
  const [feeDestinationOwner, setFeeDestinationOwner] = useState('');
  const [feeDestinationSubaccount, setFeeDestinationSubaccount] = useState('');
  const [paymentRequired, setPaymentRequired] = useState(true);
  const [conversionRate, setConversionRate] = useState(null);
  
  // Balances
  const [cyclesBalance, setCyclesBalance] = useState(null);
  const [icpBalance, setIcpBalance] = useState(null);
  
  // Admin management
  const [adminList, setAdminList] = useState([]);
  const [addAdminPrincipal, setAddAdminPrincipal] = useState('');
  const [removeAdminPrincipal, setRemoveAdminPrincipal] = useState('');
  
  // Governance
  const [sneedGovernance, setSneedGovernance] = useState(null);
  const [newGovernancePrincipal, setNewGovernancePrincipal] = useState('');
  
  // Managers
  const [managers, setManagers] = useState([]);
  const [managerCount, setManagerCount] = useState(0);
  
  // Admin functions
  const [topUpAmount, setTopUpAmount] = useState('');
  const [withdrawAmount, setWithdrawAmount] = useState('');
  const [withdrawToOwner, setWithdrawToOwner] = useState('');
  const [withdrawToSubaccount, setWithdrawToSubaccount] = useState('');

  // Use admin check hook
  useAdminCheck({ identity, isAuthenticated });

  useEffect(() => {
    if (isAuthenticated && identity) {
      fetchInitialData();
    }
  }, [isAuthenticated, identity]);

  const getFactoryActor = () => {
    if (!identity) return null;
    return createFactoryActor(factoryCanisterId, {
      agentOptions: { 
        identity,
        host: process.env.DFX_NETWORK === 'ic' || process.env.DFX_NETWORK === 'staging' 
          ? 'https://icp0.io' 
          : 'http://localhost:4943'
      }
    });
  };

  const fetchInitialData = async () => {
    setLoading(true);
    try {
      const actor = getFactoryActor();
      if (!actor) return;

      const [config, admins, governance, cycles, icp, count, rate] = await Promise.all([
        actor.getPaymentConfig(),
        actor.getAdmins(),
        actor.getSneedGovernance(),
        actor.getCyclesBalance(),
        actor.getIcpBalance(),
        actor.getManagerCount(),
        actor.getConversionRate().catch(() => null)
      ]);

      setPaymentConfig(config);
      setCreationFee((Number(config.creationFeeE8s) / E8S).toString());
      setTargetCycles((Number(config.targetCyclesAmount) / 1_000_000_000_000).toString());
      setFeeDestinationOwner(config.feeDestination.owner.toText());
      if (config.feeDestination.subaccount && config.feeDestination.subaccount.length > 0) {
        setFeeDestinationSubaccount(bytesToHex(config.feeDestination.subaccount[0]));
      }
      setPaymentRequired(config.paymentRequired);
      if (rate) {
        setConversionRate(rate);
      }
      
      setAdminList(admins);
      setSneedGovernance(governance.length > 0 ? governance[0] : null);
      setCyclesBalance(cycles);
      setIcpBalance(icp);
      setManagerCount(Number(count));
    } catch (err) {
      console.error('Error fetching initial data:', err);
      setError('Failed to load initial data: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  const bytesToHex = (bytes) => {
    return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
  };

  const hexToBytes = (hex) => {
    if (!hex || hex.length === 0) return null;
    const bytes = [];
    for (let i = 0; i < hex.length; i += 2) {
      bytes.push(parseInt(hex.substr(i, 2), 16));
    }
    return new Uint8Array(bytes);
  };

  const formatCycles = (cycles) => {
    if (cycles === null || cycles === undefined) return 'Loading...';
    const t = Number(cycles) / 1_000_000_000_000;
    if (t >= 1) return `${t.toFixed(2)} T`;
    const b = Number(cycles) / 1_000_000_000;
    if (b >= 1) return `${b.toFixed(2)} B`;
    const m = Number(cycles) / 1_000_000;
    return `${m.toFixed(2)} M`;
  };

  const formatIcp = (e8s) => {
    if (e8s === null || e8s === undefined) return 'Loading...';
    return (Number(e8s) / E8S).toFixed(4) + ' ICP';
  };

  // Handler functions
  const handleUpdatePaymentConfig = async (e) => {
    e.preventDefault();
    try {
      setLoading(true);
      setError('');
      setSuccess('');
      const actor = getFactoryActor();
      if (!actor) throw new Error('Failed to create actor');

      const config = {
        creationFeeE8s: BigInt(Math.round(parseFloat(creationFee) * E8S)),
        targetCyclesAmount: BigInt(Math.round(parseFloat(targetCycles) * 1_000_000_000_000)),
        feeDestination: {
          owner: Principal.fromText(feeDestinationOwner),
          subaccount: feeDestinationSubaccount ? [hexToBytes(feeDestinationSubaccount)] : []
        },
        paymentRequired: paymentRequired
      };

      await actor.setPaymentConfig(config);
      setSuccess('Payment configuration updated successfully');
      await fetchInitialData();
    } catch (err) {
      console.error('Error updating payment config:', err);
      setError('Failed to update payment config: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleSetPaymentRequired = async (required) => {
    try {
      setLoading(true);
      setError('');
      setSuccess('');
      const actor = getFactoryActor();
      if (!actor) throw new Error('Failed to create actor');

      await actor.setPaymentRequired(required);
      setPaymentRequired(required);
      setSuccess(`Payment requirement ${required ? 'enabled' : 'disabled'} successfully`);
    } catch (err) {
      console.error('Error setting payment required:', err);
      setError('Failed to set payment required: ' + err.message);
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
      const actor = getFactoryActor();
      if (!actor) throw new Error('Failed to create actor');

      const adminPrincipal = Principal.fromText(addAdminPrincipal);
      await actor.addAdmin(adminPrincipal);
      setSuccess(`Admin added: ${addAdminPrincipal}`);
      setAddAdminPrincipal('');
      
      const admins = await actor.getAdmins();
      setAdminList(admins);
    } catch (err) {
      console.error('Error adding admin:', err);
      setError('Failed to add admin: ' + err.message);
    } finally {
      setLoading(false);
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
      const actor = getFactoryActor();
      if (!actor) throw new Error('Failed to create actor');

      const adminPrincipal = Principal.fromText(removeAdminPrincipal);
      await actor.removeAdmin(adminPrincipal);
      setSuccess(`Admin removed: ${removeAdminPrincipal}`);
      setRemoveAdminPrincipal('');
      
      const admins = await actor.getAdmins();
      setAdminList(admins);
    } catch (err) {
      console.error('Error removing admin:', err);
      setError('Failed to remove admin: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleSetGovernance = async (e) => {
    e.preventDefault();
    try {
      setLoading(true);
      setError('');
      setSuccess('');
      const actor = getFactoryActor();
      if (!actor) throw new Error('Failed to create actor');

      const governance = newGovernancePrincipal 
        ? [Principal.fromText(newGovernancePrincipal)] 
        : [];
      
      await actor.setSneedGovernance(governance.length > 0 ? governance[0] : null);
      setSuccess(newGovernancePrincipal 
        ? `Sneed Governance set to: ${newGovernancePrincipal}` 
        : 'Sneed Governance cleared');
      setSneedGovernance(governance.length > 0 ? governance[0] : null);
      setNewGovernancePrincipal('');
    } catch (err) {
      console.error('Error setting governance:', err);
      setError('Failed to set governance: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleTopUpCycles = async (e) => {
    e.preventDefault();
    if (!topUpAmount || parseFloat(topUpAmount) <= 0) {
      setError('Please enter a valid ICP amount for top-up');
      return;
    }
    
    try {
      setLoading(true);
      setError('');
      setSuccess('');
      const actor = getFactoryActor();
      if (!actor) throw new Error('Failed to create actor');

      const amountE8s = BigInt(Math.round(parseFloat(topUpAmount) * E8S));
      const result = await actor.adminTopUpCycles(amountE8s);
      
      if ('Ok' in result) {
        setSuccess(`Top-up successful! Received ${formatCycles(result.Ok)} cycles`);
        setTopUpAmount('');
        await fetchInitialData();
      } else {
        setError(`Top-up failed: ${JSON.stringify(result.Err)}`);
      }
    } catch (err) {
      console.error('Error topping up cycles:', err);
      setError('Failed to top up cycles: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleWithdrawIcp = async (e) => {
    e.preventDefault();
    if (!withdrawAmount || parseFloat(withdrawAmount) <= 0) {
      setError('Please enter a valid ICP amount to withdraw');
      return;
    }
    if (!withdrawToOwner) {
      setError('Please enter a destination principal');
      return;
    }
    
    try {
      setLoading(true);
      setError('');
      setSuccess('');
      const actor = getFactoryActor();
      if (!actor) throw new Error('Failed to create actor');

      const amountE8s = BigInt(Math.round(parseFloat(withdrawAmount) * E8S));
      const toAccount = {
        owner: Principal.fromText(withdrawToOwner),
        subaccount: withdrawToSubaccount ? [hexToBytes(withdrawToSubaccount)] : []
      };
      
      const result = await actor.adminWithdrawIcp(amountE8s, toAccount);
      
      if ('Ok' in result) {
        setSuccess(`Withdrawal successful! Transfer index: ${result.Ok}`);
        setWithdrawAmount('');
        setWithdrawToOwner('');
        setWithdrawToSubaccount('');
        await fetchInitialData();
      } else {
        setError(`Withdrawal failed: ${JSON.stringify(result.Err)}`);
      }
    } catch (err) {
      console.error('Error withdrawing ICP:', err);
      setError('Failed to withdraw ICP: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  const fetchAllManagers = async () => {
    try {
      setLoading(true);
      const actor = getFactoryActor();
      if (!actor) return;
      
      const allManagers = await actor.getAllManagers();
      setManagers(allManagers);
    } catch (err) {
      console.error('Error fetching managers:', err);
      setError('Failed to fetch managers: ' + err.message);
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

  // Render functions
  const renderPaymentConfig = () => (
    <div>
      <h2 style={{ color: '#ffffff', fontSize: '24px', marginBottom: '20px' }}>Payment Configuration</h2>
      
      {/* Current Balances */}
      <div style={{
        backgroundColor: '#2a2a2a',
        borderRadius: '8px',
        padding: '20px',
        marginBottom: '20px',
        border: '1px solid #3a3a3a'
      }}>
        <h3 style={{ color: '#ffffff', fontSize: '18px', marginBottom: '15px' }}>Factory Balances</h3>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '20px' }}>
          <div>
            <div style={{ color: '#888', fontSize: '12px', marginBottom: '5px' }}>Cycles Balance</div>
            <div style={{ color: '#2ecc71', fontSize: '24px', fontWeight: 'bold' }}>
              {formatCycles(cyclesBalance)}
            </div>
          </div>
          <div>
            <div style={{ color: '#888', fontSize: '12px', marginBottom: '5px' }}>ICP Balance</div>
            <div style={{ color: '#f39c12', fontSize: '24px', fontWeight: 'bold' }}>
              {formatIcp(icpBalance)}
            </div>
          </div>
          <div>
            <div style={{ color: '#888', fontSize: '12px', marginBottom: '5px' }}>Total Managers Created</div>
            <div style={{ color: '#3498db', fontSize: '24px', fontWeight: 'bold' }}>
              {managerCount}
            </div>
          </div>
        </div>
      </div>

      {/* Payment Required Toggle */}
      <div style={{
        backgroundColor: '#2a2a2a',
        borderRadius: '8px',
        padding: '20px',
        marginBottom: '20px',
        border: '1px solid #3a3a3a'
      }}>
        <h3 style={{ color: '#ffffff', fontSize: '18px', marginBottom: '15px' }}>Payment Requirement</h3>
        <p style={{ color: '#888', fontSize: '14px', marginBottom: '15px' }}>
          When enabled, users must pay the creation fee to create a new neuron manager.
        </p>
        <div style={{ display: 'flex', alignItems: 'center', gap: '15px' }}>
          <span style={{ color: '#ffffff' }}>
            Currently: <strong style={{ color: paymentRequired ? '#2ecc71' : '#e74c3c' }}>
              {paymentRequired ? 'Required' : 'Not Required (Free)'}
            </strong>
          </span>
          <button
            onClick={() => handleSetPaymentRequired(!paymentRequired)}
            disabled={loading}
            style={{
              backgroundColor: paymentRequired ? '#e74c3c' : '#2ecc71',
              color: '#ffffff',
              border: 'none',
              borderRadius: '4px',
              padding: '8px 16px',
              cursor: loading ? 'not-allowed' : 'pointer',
              opacity: loading ? 0.6 : 1
            }}
          >
            {paymentRequired ? 'Disable Payment' : 'Enable Payment'}
          </button>
        </div>
      </div>

      {/* Conversion Rate Info */}
      {conversionRate && (
        <div style={{
          backgroundColor: '#2a2a2a',
          borderRadius: '8px',
          padding: '20px',
          marginBottom: '20px',
          border: '1px solid #3a3a3a'
        }}>
          <h3 style={{ color: '#ffffff', fontSize: '18px', marginBottom: '15px' }}>Current CMC Conversion Rate</h3>
          <p style={{ color: '#888', fontSize: '14px', marginBottom: '10px' }}>
            The factory automatically calculates ICP needed for cycles based on the live CMC rate.
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '20px' }}>
            <div>
              <div style={{ color: '#888', fontSize: '12px', marginBottom: '5px' }}>Cycles per ICP</div>
              <div style={{ color: '#2ecc71', fontSize: '20px', fontWeight: 'bold' }}>
                {formatCycles(Number(conversionRate.cyclesPerIcp))}
              </div>
            </div>
            <div>
              <div style={{ color: '#888', fontSize: '12px', marginBottom: '5px' }}>Estimated ICP for 2T Cycles</div>
              <div style={{ color: '#f39c12', fontSize: '20px', fontWeight: 'bold' }}>
                {conversionRate.cyclesPerIcp > 0 
                  ? ((2_000_000_000_000 / Number(conversionRate.cyclesPerIcp)) * 1.05).toFixed(4) + ' ICP'
                  : '...'
                }
              </div>
              <div style={{ color: '#666', fontSize: '11px' }}>(includes 5% buffer)</div>
            </div>
          </div>
        </div>
      )}

      {/* Fee Configuration Form */}
      <div style={{
        backgroundColor: '#2a2a2a',
        borderRadius: '8px',
        padding: '20px',
        marginBottom: '20px',
        border: '1px solid #3a3a3a'
      }}>
        <h3 style={{ color: '#ffffff', fontSize: '18px', marginBottom: '15px' }}>Fee Settings</h3>
        <form onSubmit={handleUpdatePaymentConfig}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: '15px' }}>
            <div>
              <label style={{ color: '#888', fontSize: '12px', display: 'block', marginBottom: '5px' }}>
                Creation Fee (ICP)
              </label>
              <input
                type="number"
                step="0.0001"
                min="0"
                placeholder="1.0"
                value={creationFee}
                onChange={(e) => setCreationFee(e.target.value)}
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
                Total fee charged to create a new manager
              </p>
            </div>
            <div>
              <label style={{ color: '#888', fontSize: '12px', display: 'block', marginBottom: '5px' }}>
                Target Cycles (Trillion)
              </label>
              <input
                type="number"
                step="0.1"
                min="0"
                placeholder="2"
                value={targetCycles}
                onChange={(e) => setTargetCycles(e.target.value)}
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
                Target cycles to acquire per creation (ICP calculated dynamically)
              </p>
            </div>
          </div>
          
          <div style={{ marginTop: '20px' }}>
            <h4 style={{ color: '#ffffff', fontSize: '16px', marginBottom: '10px' }}>Fee Destination</h4>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '15px' }}>
              <div>
                <label style={{ color: '#888', fontSize: '12px', display: 'block', marginBottom: '5px' }}>
                  Destination Principal
                </label>
                <input
                  type="text"
                  placeholder="Principal ID"
                  value={feeDestinationOwner}
                  onChange={(e) => setFeeDestinationOwner(e.target.value)}
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
              <div>
                <label style={{ color: '#888', fontSize: '12px', display: 'block', marginBottom: '5px' }}>
                  Destination Subaccount (optional, hex)
                </label>
                <input
                  type="text"
                  placeholder="Optional 64-character hex subaccount"
                  value={feeDestinationSubaccount}
                  onChange={(e) => setFeeDestinationSubaccount(e.target.value)}
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
              padding: '12px 24px',
              marginTop: '20px',
              cursor: loading ? 'not-allowed' : 'pointer',
              opacity: loading ? 0.6 : 1,
              fontSize: '16px'
            }}
          >
            Update Configuration
          </button>
        </form>
      </div>
    </div>
  );

  const renderAdmins = () => (
    <div>
      <h2 style={{ color: '#ffffff', fontSize: '24px', marginBottom: '20px' }}>Admin Management</h2>
      
      {/* Admin List */}
      <div style={{
        backgroundColor: '#2a2a2a',
        borderRadius: '8px',
        padding: '20px',
        marginBottom: '20px',
        border: '1px solid #3a3a3a'
      }}>
        <h3 style={{ color: '#ffffff', fontSize: '18px', marginBottom: '15px' }}>Current Admins ({adminList.length})</h3>
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
              disabled={loading}
              style={{
                backgroundColor: '#2ecc71',
                color: '#ffffff',
                border: 'none',
                borderRadius: '4px',
                padding: '10px 20px',
                cursor: loading ? 'not-allowed' : 'pointer',
                whiteSpace: 'nowrap',
                opacity: loading ? 0.6 : 1
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
              disabled={loading}
              style={{
                backgroundColor: '#e74c3c',
                color: '#ffffff',
                border: 'none',
                borderRadius: '4px',
                padding: '10px 20px',
                cursor: loading ? 'not-allowed' : 'pointer',
                whiteSpace: 'nowrap',
                opacity: loading ? 0.6 : 1
              }}
            >
              Remove Admin
            </button>
          </div>
          <p style={{ color: '#888', fontSize: '11px', marginTop: '8px' }}>
            ⚠️ Warning: At least one admin must remain
          </p>
        </form>
      </div>

      {/* Sneed Governance */}
      <div style={{
        backgroundColor: '#2a2a2a',
        borderRadius: '8px',
        padding: '20px',
        border: '1px solid #3a3a3a'
      }}>
        <h3 style={{ color: '#ffffff', fontSize: '18px', marginBottom: '15px' }}>Sneed Governance</h3>
        <p style={{ color: '#888', fontSize: '14px', marginBottom: '15px' }}>
          The Sneed governance canister can also modify payment settings.
        </p>
        <div style={{ marginBottom: '15px' }}>
          <span style={{ color: '#888' }}>Current: </span>
          <span style={{ color: sneedGovernance ? '#3498db' : '#666', fontFamily: 'monospace' }}>
            {sneedGovernance ? sneedGovernance.toString() : 'Not set'}
          </span>
        </div>
        <form onSubmit={handleSetGovernance} style={{ display: 'flex', gap: '10px', alignItems: 'flex-end' }}>
          <div style={{ flex: 1 }}>
            <label style={{ color: '#888', fontSize: '12px', display: 'block', marginBottom: '5px' }}>
              Set Governance Principal (leave empty to clear)
            </label>
            <input
              type="text"
              placeholder="Enter governance principal or leave empty"
              value={newGovernancePrincipal}
              onChange={(e) => setNewGovernancePrincipal(e.target.value)}
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
              backgroundColor: '#9b59b6',
              color: '#ffffff',
              border: 'none',
              borderRadius: '4px',
              padding: '10px 20px',
              cursor: loading ? 'not-allowed' : 'pointer',
              whiteSpace: 'nowrap',
              opacity: loading ? 0.6 : 1
            }}
          >
            {newGovernancePrincipal ? 'Set' : 'Clear'} Governance
          </button>
        </form>
      </div>
    </div>
  );

  const renderOperations = () => (
    <div>
      <h2 style={{ color: '#ffffff', fontSize: '24px', marginBottom: '20px' }}>Admin Operations</h2>
      
      {/* Top Up Cycles */}
      <div style={{
        backgroundColor: '#2a2a2a',
        borderRadius: '8px',
        padding: '20px',
        marginBottom: '20px',
        border: '1px solid #3a3a3a'
      }}>
        <h3 style={{ color: '#ffffff', fontSize: '18px', marginBottom: '15px' }}>Top Up Factory Cycles</h3>
        <p style={{ color: '#888', fontSize: '14px', marginBottom: '15px' }}>
          Convert ICP from the factory's balance to cycles. Current ICP balance: <strong style={{ color: '#f39c12' }}>{formatIcp(icpBalance)}</strong>
        </p>
        <form onSubmit={handleTopUpCycles} style={{ display: 'flex', gap: '10px', alignItems: 'flex-end' }}>
          <div style={{ flex: 1 }}>
            <label style={{ color: '#888', fontSize: '12px', display: 'block', marginBottom: '5px' }}>
              ICP Amount to Convert
            </label>
            <input
              type="number"
              step="0.0001"
              min="0"
              placeholder="0.1"
              value={topUpAmount}
              onChange={(e) => setTopUpAmount(e.target.value)}
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
            disabled={loading}
            style={{
              backgroundColor: '#2ecc71',
              color: '#ffffff',
              border: 'none',
              borderRadius: '4px',
              padding: '10px 20px',
              cursor: loading ? 'not-allowed' : 'pointer',
              whiteSpace: 'nowrap',
              opacity: loading ? 0.6 : 1
            }}
          >
            Top Up Cycles
          </button>
        </form>
      </div>

      {/* Withdraw ICP */}
      <div style={{
        backgroundColor: '#2a2a2a',
        borderRadius: '8px',
        padding: '20px',
        border: '1px solid #3a3a3a'
      }}>
        <h3 style={{ color: '#ffffff', fontSize: '18px', marginBottom: '15px' }}>Withdraw ICP</h3>
        <p style={{ color: '#888', fontSize: '14px', marginBottom: '15px' }}>
          Withdraw ICP from the factory's main account. Current balance: <strong style={{ color: '#f39c12' }}>{formatIcp(icpBalance)}</strong>
        </p>
        <form onSubmit={handleWithdrawIcp}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '15px' }}>
            <div>
              <label style={{ color: '#888', fontSize: '12px', display: 'block', marginBottom: '5px' }}>
                Amount (ICP)
              </label>
              <input
                type="number"
                step="0.0001"
                min="0"
                placeholder="1.0"
                value={withdrawAmount}
                onChange={(e) => setWithdrawAmount(e.target.value)}
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
                Destination Principal
              </label>
              <input
                type="text"
                placeholder="Principal ID"
                value={withdrawToOwner}
                onChange={(e) => setWithdrawToOwner(e.target.value)}
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
            <div>
              <label style={{ color: '#888', fontSize: '12px', display: 'block', marginBottom: '5px' }}>
                Destination Subaccount (optional, hex)
              </label>
              <input
                type="text"
                placeholder="Optional 64-character hex subaccount"
                value={withdrawToSubaccount}
                onChange={(e) => setWithdrawToSubaccount(e.target.value)}
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
          </div>
          <button
            type="submit"
            disabled={loading}
            style={{
              backgroundColor: '#e74c3c',
              color: '#ffffff',
              border: 'none',
              borderRadius: '4px',
              padding: '10px 20px',
              marginTop: '15px',
              cursor: loading ? 'not-allowed' : 'pointer',
              opacity: loading ? 0.6 : 1
            }}
          >
            Withdraw ICP
          </button>
        </form>
      </div>
    </div>
  );

  const renderManagers = () => (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
        <h2 style={{ color: '#ffffff', fontSize: '24px' }}>All Managers ({managers.length})</h2>
        <button
          onClick={fetchAllManagers}
          disabled={loading}
          style={{
            backgroundColor: '#3498db',
            color: '#ffffff',
            border: 'none',
            borderRadius: '4px',
            padding: '8px 16px',
            cursor: loading ? 'not-allowed' : 'pointer',
            opacity: loading ? 0.6 : 1
          }}
        >
          Load Managers
        </button>
      </div>
      
      <div style={{ backgroundColor: '#1a1a1a', borderRadius: '8px', padding: '20px', border: '1px solid #3a3a3a' }}>
        {managers.length === 0 ? (
          <div style={{ color: '#888', textAlign: 'center', padding: '20px' }}>
            Click "Load Managers" to fetch all created managers
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {managers.map((manager, idx) => (
              <div
                key={idx}
                style={{
                  backgroundColor: '#2a2a2a',
                  borderRadius: '4px',
                  padding: '15px',
                  border: '1px solid #3a3a3a'
                }}
              >
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '15px' }}>
                  <div>
                    <div style={{ color: '#888', fontSize: '11px' }}>Canister ID</div>
                    <div style={{ color: '#3498db', fontSize: '13px', fontFamily: 'monospace' }}>
                      {manager.canisterId.toText()}
                    </div>
                  </div>
                  <div>
                    <div style={{ color: '#888', fontSize: '11px' }}>Owner</div>
                    <div style={{ color: '#ffffff', fontSize: '13px', fontFamily: 'monospace' }}>
                      {formatPrincipal(manager.owner)}
                    </div>
                  </div>
                  <div>
                    <div style={{ color: '#888', fontSize: '11px' }}>Created</div>
                    <div style={{ color: '#ffffff', fontSize: '12px' }}>
                      {formatTimestamp(manager.createdAt)}
                    </div>
                  </div>
                  <div>
                    <div style={{ color: '#888', fontSize: '11px' }}>Version</div>
                    <div style={{ color: '#ffffff', fontSize: '13px' }}>
                      {manager.version.major}.{manager.version.minor}.{manager.version.patch}
                    </div>
                  </div>
                  <div>
                    <div style={{ color: '#888', fontSize: '11px' }}>Neuron ID</div>
                    <div style={{ color: manager.neuronId && manager.neuronId.length > 0 ? '#2ecc71' : '#666', fontSize: '13px' }}>
                      {manager.neuronId && manager.neuronId.length > 0 
                        ? Number(manager.neuronId[0].id).toString() 
                        : 'Not set'}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );

  if (!isAuthenticated) {
    return (
      <div className='page-container'>
        <Header />
        <div style={{ padding: '40px 20px', textAlign: 'center', color: '#ffffff' }}>
          <h2>Please log in to access ICP Neuron Manager Factory Admin</h2>
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
          ICP Neuron Manager Factory Admin
        </h1>
        <p style={{ color: '#888', marginBottom: '10px' }}>
          Manage factory settings, admins, and operations
        </p>
        <p style={{ color: '#666', fontSize: '13px', marginBottom: '30px', fontFamily: 'monospace' }}>
          Factory Canister: {factoryCanisterId}
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
          {['config', 'admins', 'operations', 'managers'].map(tab => (
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
              {tab === 'config' && 'Payment Config'}
              {tab === 'admins' && 'Admins'}
              {tab === 'operations' && 'Operations'}
              {tab === 'managers' && 'Managers'}
            </button>
          ))}
        </div>

        {/* Tab Content */}
        {loading && activeTab !== 'managers' ? (
          <div style={{ textAlign: 'center', padding: '40px', color: '#888' }}>
            Loading...
          </div>
        ) : (
          <>
            {activeTab === 'config' && renderPaymentConfig()}
            {activeTab === 'admins' && renderAdmins()}
            {activeTab === 'operations' && renderOperations()}
            {activeTab === 'managers' && renderManagers()}
          </>
        )}
      </main>
    </div>
  );
}

