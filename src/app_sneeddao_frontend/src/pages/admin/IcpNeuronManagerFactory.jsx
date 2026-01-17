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
  
  // Canister creation cycles
  const [canisterCreationCycles, setCanisterCreationCycles] = useState('');
  
  // Manager WASM management
  const [hasWasm, setHasWasm] = useState(false);
  const [wasmSize, setWasmSize] = useState(0);
  const [wasmFile, setWasmFile] = useState(null);
  const [uploadingWasm, setUploadingWasm] = useState(false);
  const [wasmVersionMajor, setWasmVersionMajor] = useState('');
  const [wasmVersionMinor, setWasmVersionMinor] = useState('');
  const [wasmVersionPatch, setWasmVersionPatch] = useState('');
  const [managerVersion, setManagerVersion] = useState(null);
  
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
  
  // Official versions management
  const [officialVersions, setOfficialVersions] = useState([]);
  const [newVersion, setNewVersion] = useState({
    major: '',
    minor: '',
    patch: '',
    wasmHash: '',
    wasmUrl: '',
    sourceUrl: ''
  });
  const [editingVersionHash, setEditingVersionHash] = useState(null);
  
  // Creation log state
  const [creationLog, setCreationLog] = useState([]);
  const [creationLogTotalCount, setCreationLogTotalCount] = useState(0);
  const [creationLogHasMore, setCreationLogHasMore] = useState(false);
  const [creationLogPage, setCreationLogPage] = useState(0);
  const [creationLogPageSize] = useState(20);
  const [creationLogLoading, setCreationLogLoading] = useState(false);
  const [logCallerFilter, setLogCallerFilter] = useState('');
  const [logCanisterFilter, setLogCanisterFilter] = useState('');
  const [logFromDate, setLogFromDate] = useState('');
  const [logToDate, setLogToDate] = useState('');
  
  // Factory aggregates (financial stats)
  const [factoryAggregates, setFactoryAggregates] = useState(null);
  const [statsLoading, setStatsLoading] = useState(false);

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

      const [config, admins, governance, cycles, icp, count, rate, versions, creationCycles, wasmExists, wasmBytes, mgrVersion] = await Promise.all([
        actor.getPaymentConfig(),
        actor.getAdmins(),
        actor.getSneedGovernance(),
        actor.getCyclesBalance(),
        actor.getIcpBalance(),
        actor.getManagerCount(),
        actor.getConversionRate().catch(() => null),
        actor.getOfficialVersions().catch(() => []),
        actor.getCanisterCreationCycles().catch(() => 1_000_000_000_000n),
        actor.hasManagerWasm().catch(() => false),
        actor.getManagerWasmSize().catch(() => 0),
        actor.getCurrentVersion().catch(() => ({ major: 0n, minor: 0n, patch: 0n }))
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
      setOfficialVersions(versions);
      setCanisterCreationCycles((Number(creationCycles) / 1_000_000_000_000).toString());
      setHasWasm(wasmExists);
      setWasmSize(Number(wasmBytes));
      setManagerVersion(mgrVersion);
      setWasmVersionMajor(Number(mgrVersion.major).toString());
      setWasmVersionMinor(Number(mgrVersion.minor).toString());
      setWasmVersionPatch(Number(mgrVersion.patch).toString());
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

  const handleSetCanisterCreationCycles = async (e) => {
    e.preventDefault();
    if (!canisterCreationCycles || parseFloat(canisterCreationCycles) <= 0) {
      setError('Please enter a valid cycles amount (in Trillion)');
      return;
    }
    
    try {
      setLoading(true);
      setError('');
      setSuccess('');
      const actor = getFactoryActor();
      if (!actor) throw new Error('Failed to create actor');

      const cyclesAmount = BigInt(Math.round(parseFloat(canisterCreationCycles) * 1_000_000_000_000));
      await actor.setCanisterCreationCycles(cyclesAmount);
      setSuccess(`Canister creation cycles updated to ${canisterCreationCycles}T`);
      await fetchInitialData();
    } catch (err) {
      console.error('Error setting canister creation cycles:', err);
      setError('Failed to set canister creation cycles: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleWasmFileSelect = (e) => {
    const file = e.target.files[0];
    if (file) {
      // Validate file type
      if (!file.name.endsWith('.wasm')) {
        setError('Please select a .wasm file');
        return;
      }
      setWasmFile(file);
      setError('');
    }
  };

  const handleUploadWasm = async () => {
    if (!wasmFile) {
      setError('Please select a WASM file first');
      return;
    }

    // Validate version
    const major = parseInt(wasmVersionMajor, 10);
    const minor = parseInt(wasmVersionMinor, 10);
    const patch = parseInt(wasmVersionPatch, 10);
    
    if (isNaN(major) || isNaN(minor) || isNaN(patch) || major < 0 || minor < 0 || patch < 0) {
      setError('Please enter a valid version (major, minor, patch must be non-negative integers)');
      return;
    }

    try {
      setUploadingWasm(true);
      setError('');
      setSuccess('');
      
      const actor = getFactoryActor();
      if (!actor) throw new Error('Failed to create actor');

      // Read file as ArrayBuffer
      const arrayBuffer = await wasmFile.arrayBuffer();
      const wasmBytes = new Uint8Array(arrayBuffer);
      
      // Validate WASM magic bytes
      if (wasmBytes[0] !== 0x00 || wasmBytes[1] !== 0x61 || 
          wasmBytes[2] !== 0x73 || wasmBytes[3] !== 0x6d) {
        setError('Invalid WASM file: missing magic bytes');
        return;
      }

      // Upload WASM to canister
      await actor.setManagerWasm(wasmBytes);
      
      // Set the version
      await actor.setCurrentVersion({
        major: BigInt(major),
        minor: BigInt(minor),
        patch: BigInt(patch)
      });
      
      setSuccess(`Successfully uploaded WASM v${major}.${minor}.${patch} (${(wasmBytes.length / 1024).toFixed(1)} KB)`);
      setWasmFile(null);
      await fetchInitialData();
    } catch (err) {
      console.error('Error uploading WASM:', err);
      setError('Failed to upload WASM: ' + err.message);
    } finally {
      setUploadingWasm(false);
    }
  };

  const handleClearWasm = async () => {
    if (!window.confirm('Are you sure you want to clear the manager WASM? New managers cannot be created until a new WASM is uploaded.')) {
      return;
    }

    try {
      setLoading(true);
      setError('');
      setSuccess('');
      
      const actor = getFactoryActor();
      if (!actor) throw new Error('Failed to create actor');

      await actor.clearManagerWasm();
      
      setSuccess('Manager WASM cleared successfully');
      await fetchInitialData();
    } catch (err) {
      console.error('Error clearing WASM:', err);
      setError('Failed to clear WASM: ' + err.message);
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
      
      const allRegistrations = await actor.getAllRegistrations();
      // Flatten the registrations into a displayable format
      const flattenedManagers = [];
      for (const [owner, canisterIds] of allRegistrations) {
        for (const canisterId of canisterIds) {
          flattenedManagers.push({ owner, canisterId });
        }
      }
      setManagers(flattenedManagers);
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

  // Version management handlers
  const handleAddVersion = async (e) => {
    e.preventDefault();
    if (!newVersion.wasmHash || !newVersion.major || !newVersion.minor || !newVersion.patch) {
      setError('Major, minor, patch, and WASM hash are required');
      return;
    }
    
    try {
      setLoading(true);
      setError('');
      setSuccess('');
      const actor = getFactoryActor();
      if (!actor) throw new Error('Failed to create actor');

      const version = {
        major: BigInt(newVersion.major),
        minor: BigInt(newVersion.minor),
        patch: BigInt(newVersion.patch),
        wasmHash: newVersion.wasmHash.toLowerCase(),
        wasmUrl: newVersion.wasmUrl,
        sourceUrl: newVersion.sourceUrl
      };

      await actor.addOfficialVersion(version);
      setSuccess(`Version ${newVersion.major}.${newVersion.minor}.${newVersion.patch} added successfully`);
      setNewVersion({ major: '', minor: '', patch: '', wasmHash: '', wasmUrl: '', sourceUrl: '' });
      setEditingVersionHash(null);
      
      const versions = await actor.getOfficialVersions();
      setOfficialVersions(versions);
    } catch (err) {
      console.error('Error adding version:', err);
      setError('Failed to add version: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleEditVersion = (version) => {
    setNewVersion({
      major: Number(version.major).toString(),
      minor: Number(version.minor).toString(),
      patch: Number(version.patch).toString(),
      wasmHash: version.wasmHash,
      wasmUrl: version.wasmUrl,
      sourceUrl: version.sourceUrl
    });
    setEditingVersionHash(version.wasmHash);
  };

  const handleCancelEdit = () => {
    setNewVersion({ major: '', minor: '', patch: '', wasmHash: '', wasmUrl: '', sourceUrl: '' });
    setEditingVersionHash(null);
  };

  const handleRemoveVersion = async (wasmHash) => {
    if (!window.confirm('Are you sure you want to remove this version?')) {
      return;
    }
    
    try {
      setLoading(true);
      setError('');
      setSuccess('');
      const actor = getFactoryActor();
      if (!actor) throw new Error('Failed to create actor');

      const result = await actor.removeOfficialVersion(wasmHash);
      if (result) {
        setSuccess('Version removed successfully');
        const versions = await actor.getOfficialVersions();
        setOfficialVersions(versions);
      } else {
        setError('Version not found');
      }
    } catch (err) {
      console.error('Error removing version:', err);
      setError('Failed to remove version: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  // Creation log handlers - uses getMergedLog to include financial data
  const fetchCreationLog = async (page = 0, resetFilters = false) => {
    try {
      setCreationLogLoading(true);
      const actor = getFactoryActor();
      if (!actor) return;

      const query = {
        startIndex: [BigInt(page * creationLogPageSize)],
        limit: [BigInt(creationLogPageSize)],
        callerFilter: [],
        canisterFilter: [],
        fromTime: [],
        toTime: []
      };

      // Apply filters if not resetting
      if (!resetFilters) {
        if (logCallerFilter.trim()) {
          try {
            query.callerFilter = [Principal.fromText(logCallerFilter.trim())];
          } catch (e) {
            setError('Invalid caller principal format');
            setCreationLogLoading(false);
            return;
          }
        }
        
        if (logCanisterFilter.trim()) {
          try {
            query.canisterFilter = [Principal.fromText(logCanisterFilter.trim())];
          } catch (e) {
            setError('Invalid canister principal format');
            setCreationLogLoading(false);
            return;
          }
        }
        
        if (logFromDate) {
          const fromTime = new Date(logFromDate).getTime() * 1_000_000; // Convert to nanoseconds
          query.fromTime = [BigInt(fromTime)];
        }
        
        if (logToDate) {
          const toTime = new Date(logToDate).getTime() * 1_000_000 + 86400_000_000_000; // End of day in nanoseconds
          query.toTime = [BigInt(toTime)];
        }
      }

      // Try getMergedLog first (includes financial data), fallback to getCreationLog
      let result;
      try {
        result = await actor.getMergedLog(query);
      } catch (mergedErr) {
        // Fallback to getCreationLog if getMergedLog not available
        console.log('getMergedLog not available, falling back to getCreationLog');
        result = await actor.getCreationLog(query);
      }
      
      setCreationLog(result.entries);
      setCreationLogTotalCount(Number(result.totalCount));
      setCreationLogHasMore(result.hasMore);
      setCreationLogPage(page);
    } catch (err) {
      console.error('Error fetching creation log:', err);
      setError('Failed to fetch creation log: ' + err.message);
    } finally {
      setCreationLogLoading(false);
    }
  };

  const handleLogSearch = (e) => {
    e.preventDefault();
    fetchCreationLog(0, false);
  };

  const handleLogReset = () => {
    setLogCallerFilter('');
    setLogCanisterFilter('');
    setLogFromDate('');
    setLogToDate('');
    fetchCreationLog(0, true);
  };

  // Fetch factory aggregates (financial stats)
  const fetchFactoryAggregates = async () => {
    try {
      setStatsLoading(true);
      const actor = getFactoryActor();
      if (!actor) return;

      const aggregates = await actor.getFactoryAggregates();
      setFactoryAggregates(aggregates);
    } catch (err) {
      console.error('Error fetching factory aggregates:', err);
      // Don't show error - the method might not exist on older deployments
      setFactoryAggregates(null);
    } finally {
      setStatsLoading(false);
    }
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

      {/* Canister Creation Cycles */}
      <div style={{
        backgroundColor: '#2a2a2a',
        borderRadius: '8px',
        padding: '20px',
        marginBottom: '20px',
        border: '1px solid #3a3a3a'
      }}>
        <h3 style={{ color: '#ffffff', fontSize: '18px', marginBottom: '15px' }}>Canister Creation Cycles</h3>
        <p style={{ color: '#888', fontSize: '14px', marginBottom: '15px' }}>
          Amount of cycles allocated to each new neuron manager canister when created.
        </p>
        <form onSubmit={handleSetCanisterCreationCycles} style={{ display: 'flex', gap: '10px', alignItems: 'flex-end' }}>
          <div style={{ flex: 1, maxWidth: '300px' }}>
            <label style={{ color: '#888', fontSize: '12px', display: 'block', marginBottom: '5px' }}>
              Cycles (Trillion)
            </label>
            <input
              type="number"
              step="0.1"
              min="0.1"
              placeholder="1"
              value={canisterCreationCycles}
              onChange={(e) => setCanisterCreationCycles(e.target.value)}
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
              Current: {canisterCreationCycles ? `${canisterCreationCycles}T cycles` : 'Loading...'}
            </p>
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
            Update Cycles
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

      {/* Manager WASM Management */}
      <div style={{
        backgroundColor: '#2a2a2a',
        borderRadius: '8px',
        padding: '20px',
        marginTop: '20px',
        border: '1px solid #3a3a3a'
      }}>
        <h3 style={{ color: '#ffffff', fontSize: '18px', marginBottom: '15px' }}>Manager WASM Module</h3>
        <p style={{ color: '#888', fontSize: '14px', marginBottom: '15px' }}>
          Upload the ICP Neuron Manager WASM module. This WASM is used when creating new manager canisters.
        </p>
        
        {/* Current Status */}
        <div style={{
          backgroundColor: '#1a1a1a',
          borderRadius: '6px',
          padding: '15px',
          marginBottom: '15px',
          border: `1px solid ${hasWasm ? '#2ecc71' : '#e74c3c'}40`
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <div style={{ 
                color: hasWasm ? '#2ecc71' : '#e74c3c', 
                fontWeight: 'bold',
                marginBottom: '5px'
              }}>
                {hasWasm ? '✓ WASM Uploaded' : '✗ No WASM Uploaded'}
              </div>
              {hasWasm && managerVersion && (
                <div style={{ color: '#888', fontSize: '13px' }}>
                  Version: <strong style={{ color: '#3498db' }}>v{Number(managerVersion.major)}.{Number(managerVersion.minor)}.{Number(managerVersion.patch)}</strong>
                  {' · '}Size: {(wasmSize / 1024).toFixed(1)} KB ({wasmSize.toLocaleString()} bytes)
                </div>
              )}
              {!hasWasm && (
                <div style={{ color: '#888', fontSize: '13px' }}>
                  New managers cannot be created until a WASM is uploaded.
                </div>
              )}
            </div>
            {hasWasm && (
              <button
                onClick={handleClearWasm}
                disabled={loading}
                style={{
                  backgroundColor: 'transparent',
                  color: '#e74c3c',
                  border: '1px solid #e74c3c',
                  borderRadius: '4px',
                  padding: '6px 12px',
                  cursor: loading ? 'not-allowed' : 'pointer',
                  fontSize: '12px'
                }}
              >
                Clear WASM
              </button>
            )}
          </div>
        </div>

        {/* Upload Form */}
        <div style={{ display: 'flex', gap: '15px', alignItems: 'flex-end', flexWrap: 'wrap', marginBottom: '15px' }}>
          <div style={{ flex: 1, minWidth: '200px' }}>
            <label style={{ color: '#888', fontSize: '12px', display: 'block', marginBottom: '5px' }}>
              Select WASM File
            </label>
            <input
              type="file"
              accept=".wasm"
              onChange={handleWasmFileSelect}
              style={{
                width: '100%',
                padding: '8px',
                borderRadius: '4px',
                border: '1px solid #3a3a3a',
                backgroundColor: '#1a1a1a',
                color: '#ffffff'
              }}
            />
          </div>
        </div>
        
        {/* Version Input */}
        <div style={{ marginBottom: '15px' }}>
          <label style={{ color: '#888', fontSize: '12px', display: 'block', marginBottom: '5px' }}>
            WASM Version
          </label>
          <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
            <input
              type="number"
              min="0"
              placeholder="Major"
              value={wasmVersionMajor}
              onChange={(e) => setWasmVersionMajor(e.target.value)}
              style={{
                width: '80px',
                padding: '10px',
                borderRadius: '4px',
                border: '1px solid #3a3a3a',
                backgroundColor: '#1a1a1a',
                color: '#ffffff',
                textAlign: 'center'
              }}
            />
            <span style={{ color: '#888' }}>.</span>
            <input
              type="number"
              min="0"
              placeholder="Minor"
              value={wasmVersionMinor}
              onChange={(e) => setWasmVersionMinor(e.target.value)}
              style={{
                width: '80px',
                padding: '10px',
                borderRadius: '4px',
                border: '1px solid #3a3a3a',
                backgroundColor: '#1a1a1a',
                color: '#ffffff',
                textAlign: 'center'
              }}
            />
            <span style={{ color: '#888' }}>.</span>
            <input
              type="number"
              min="0"
              placeholder="Patch"
              value={wasmVersionPatch}
              onChange={(e) => setWasmVersionPatch(e.target.value)}
              style={{
                width: '80px',
                padding: '10px',
                borderRadius: '4px',
                border: '1px solid #3a3a3a',
                backgroundColor: '#1a1a1a',
                color: '#ffffff',
                textAlign: 'center'
              }}
            />
          </div>
        </div>
        
        <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
          <button
            onClick={handleUploadWasm}
            disabled={uploadingWasm || !wasmFile}
            style={{
              backgroundColor: wasmFile ? '#9b59b6' : '#444',
              color: '#ffffff',
              border: 'none',
              borderRadius: '4px',
              padding: '10px 20px',
              cursor: (uploadingWasm || !wasmFile) ? 'not-allowed' : 'pointer',
              opacity: uploadingWasm ? 0.6 : 1,
              whiteSpace: 'nowrap'
            }}
          >
            {uploadingWasm ? 'Uploading...' : 'Upload WASM'}
          </button>
          {wasmFile && (
            <span style={{ color: '#888', fontSize: '12px' }}>
              Selected: {wasmFile.name} ({(wasmFile.size / 1024).toFixed(1)} KB)
            </span>
          )}
        </div>
      </div>
    </div>
  );

  const renderManagers = () => (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
        <h2 style={{ color: '#ffffff', fontSize: '24px' }}>All Registrations ({managers.length})</h2>
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
          Load Registrations
        </button>
      </div>
      
      <div style={{ backgroundColor: '#1a1a1a', borderRadius: '8px', padding: '20px', border: '1px solid #3a3a3a' }}>
        {managers.length === 0 ? (
          <div style={{ color: '#888', textAlign: 'center', padding: '20px' }}>
            Click "Load Registrations" to fetch all user registrations
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
                    <div style={{ color: '#888', fontSize: '11px' }}>Registered By</div>
                    <div style={{ color: '#ffffff', fontSize: '13px', fontFamily: 'monospace' }}>
                      {formatPrincipal(manager.owner)}
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

  const renderVersions = () => (
    <div>
      <h2 style={{ color: '#ffffff', fontSize: '24px', marginBottom: '20px' }}>Official Versions</h2>
      <p style={{ color: '#888', fontSize: '14px', marginBottom: '20px' }}>
        Manage the list of known official WASM versions. Users can verify their canister's WASM hash against this registry.
      </p>
      
      {/* Add/Edit Version Form */}
      <div style={{
        backgroundColor: '#2a2a2a',
        borderRadius: '8px',
        padding: '20px',
        marginBottom: '20px',
        border: '1px solid #3a3a3a'
      }}>
        <h3 style={{ color: '#ffffff', fontSize: '18px', marginBottom: '15px' }}>
          {editingVersionHash ? 'Edit Version' : 'Add New Version'}
        </h3>
        <form onSubmit={handleAddVersion}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '15px', marginBottom: '15px' }}>
            <div>
              <label style={{ color: '#888', fontSize: '12px', display: 'block', marginBottom: '5px' }}>
                Major *
              </label>
              <input
                type="number"
                min="0"
                placeholder="1"
                value={newVersion.major}
                onChange={(e) => setNewVersion({...newVersion, major: e.target.value})}
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
                Minor *
              </label>
              <input
                type="number"
                min="0"
                placeholder="0"
                value={newVersion.minor}
                onChange={(e) => setNewVersion({...newVersion, minor: e.target.value})}
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
                Patch *
              </label>
              <input
                type="number"
                min="0"
                placeholder="0"
                value={newVersion.patch}
                onChange={(e) => setNewVersion({...newVersion, patch: e.target.value})}
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
          
          <div style={{ marginBottom: '15px' }}>
            <label style={{ color: '#888', fontSize: '12px', display: 'block', marginBottom: '5px' }}>
              WASM Hash * (SHA256 hex)
            </label>
            <input
              type="text"
              placeholder="e.g., a1b2c3d4e5f6..."
              value={newVersion.wasmHash}
              onChange={(e) => setNewVersion({...newVersion, wasmHash: e.target.value})}
              disabled={!!editingVersionHash}
              style={{
                width: '100%',
                padding: '10px',
                borderRadius: '4px',
                border: '1px solid #3a3a3a',
                backgroundColor: editingVersionHash ? '#333' : '#1a1a1a',
                color: '#ffffff',
                fontFamily: 'monospace',
                fontSize: '13px'
              }}
            />
            <p style={{ color: '#666', fontSize: '11px', marginTop: '4px' }}>
              Get this from: dfx canister info &lt;canister_id&gt; --network ic
            </p>
          </div>
          
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '15px', marginBottom: '15px' }}>
            <div>
              <label style={{ color: '#888', fontSize: '12px', display: 'block', marginBottom: '5px' }}>
                WASM URL (optional)
              </label>
              <input
                type="text"
                placeholder="https://github.com/org/repo/releases/download/v1.0.0/canister.wasm"
                value={newVersion.wasmUrl}
                onChange={(e) => setNewVersion({...newVersion, wasmUrl: e.target.value})}
                style={{
                  width: '100%',
                  padding: '10px',
                  borderRadius: '4px',
                  border: '1px solid #3a3a3a',
                  backgroundColor: '#1a1a1a',
                  color: '#ffffff',
                  fontSize: '13px'
                }}
              />
            </div>
            <div>
              <label style={{ color: '#888', fontSize: '12px', display: 'block', marginBottom: '5px' }}>
                Source URL (optional)
              </label>
              <input
                type="text"
                placeholder="https://github.com/org/repo/releases/tag/v1.0.0"
                value={newVersion.sourceUrl}
                onChange={(e) => setNewVersion({...newVersion, sourceUrl: e.target.value})}
                style={{
                  width: '100%',
                  padding: '10px',
                  borderRadius: '4px',
                  border: '1px solid #3a3a3a',
                  backgroundColor: '#1a1a1a',
                  color: '#ffffff',
                  fontSize: '13px'
                }}
              />
            </div>
          </div>
          
          <div style={{ display: 'flex', gap: '10px' }}>
            <button
              type="submit"
              disabled={loading}
              style={{
                backgroundColor: editingVersionHash ? '#f39c12' : '#2ecc71',
                color: '#ffffff',
                border: 'none',
                borderRadius: '4px',
                padding: '10px 20px',
                cursor: loading ? 'not-allowed' : 'pointer',
                opacity: loading ? 0.6 : 1
              }}
            >
              {editingVersionHash ? 'Update Version' : 'Add Version'}
            </button>
            {editingVersionHash && (
              <button
                type="button"
                onClick={handleCancelEdit}
                style={{
                  backgroundColor: 'transparent',
                  color: '#888',
                  border: '1px solid #3a3a3a',
                  borderRadius: '4px',
                  padding: '10px 20px',
                  cursor: 'pointer'
                }}
              >
                Cancel
              </button>
            )}
          </div>
        </form>
      </div>
      
      {/* Version List */}
      <div style={{
        backgroundColor: '#2a2a2a',
        borderRadius: '8px',
        padding: '20px',
        border: '1px solid #3a3a3a'
      }}>
        <h3 style={{ color: '#ffffff', fontSize: '18px', marginBottom: '15px' }}>
          Registered Versions ({officialVersions.length})
        </h3>
        
        {officialVersions.length === 0 ? (
          <div style={{ color: '#888', textAlign: 'center', padding: '30px' }}>
            No official versions registered yet. Add one above.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
            {officialVersions.map((version, idx) => (
              <div
                key={idx}
                style={{
                  backgroundColor: '#1a1a1a',
                  borderRadius: '6px',
                  padding: '15px',
                  border: '1px solid #3a3a3a'
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '12px' }}>
                  <div>
                    <span style={{ 
                      color: '#2ecc71', 
                      fontSize: '20px', 
                      fontWeight: 'bold',
                      marginRight: '10px'
                    }}>
                      v{Number(version.major)}.{Number(version.minor)}.{Number(version.patch)}
                    </span>
                  </div>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <button
                      onClick={() => handleEditVersion(version)}
                      style={{
                        backgroundColor: 'transparent',
                        color: '#3498db',
                        border: '1px solid #3498db',
                        borderRadius: '4px',
                        padding: '4px 12px',
                        cursor: 'pointer',
                        fontSize: '12px'
                      }}
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => handleRemoveVersion(version.wasmHash)}
                      style={{
                        backgroundColor: 'transparent',
                        color: '#e74c3c',
                        border: '1px solid #e74c3c',
                        borderRadius: '4px',
                        padding: '4px 12px',
                        cursor: 'pointer',
                        fontSize: '12px'
                      }}
                    >
                      Remove
                    </button>
                  </div>
                </div>
                
                <div style={{ marginBottom: '10px' }}>
                  <div style={{ color: '#888', fontSize: '11px', marginBottom: '2px' }}>WASM Hash</div>
                  <div style={{ 
                    color: '#9b59b6', 
                    fontFamily: 'monospace', 
                    fontSize: '12px',
                    wordBreak: 'break-all',
                    backgroundColor: '#2a2a2a',
                    padding: '6px 8px',
                    borderRadius: '4px'
                  }}>
                    {version.wasmHash}
                  </div>
                </div>
                
                {(version.wasmUrl || version.sourceUrl) && (
                  <div style={{ display: 'flex', gap: '20px', flexWrap: 'wrap' }}>
                    {version.wasmUrl && (
                      <div>
                        <div style={{ color: '#888', fontSize: '11px', marginBottom: '2px' }}>WASM URL</div>
                        <a 
                          href={version.wasmUrl} 
                          target="_blank" 
                          rel="noopener noreferrer"
                          style={{ color: '#3498db', fontSize: '12px', wordBreak: 'break-all' }}
                        >
                          {version.wasmUrl.length > 60 ? version.wasmUrl.slice(0, 60) + '...' : version.wasmUrl}
                        </a>
                      </div>
                    )}
                    {version.sourceUrl && (
                      <div>
                        <div style={{ color: '#888', fontSize: '11px', marginBottom: '2px' }}>Source URL</div>
                        <a 
                          href={version.sourceUrl} 
                          target="_blank" 
                          rel="noopener noreferrer"
                          style={{ color: '#3498db', fontSize: '12px', wordBreak: 'break-all' }}
                        >
                          {version.sourceUrl.length > 60 ? version.sourceUrl.slice(0, 60) + '...' : version.sourceUrl}
                        </a>
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );

  const renderCreationLog = () => (
    <div>
      <h2 style={{ color: '#ffffff', fontSize: '24px', marginBottom: '20px' }}>Creation Log</h2>
      <p style={{ color: '#888', fontSize: '14px', marginBottom: '20px' }}>
        Audit trail of all manager canisters created through this factory.
      </p>
      
      {/* Search/Filter Form */}
      <div style={{
        backgroundColor: '#2a2a2a',
        borderRadius: '8px',
        padding: '20px',
        marginBottom: '20px',
        border: '1px solid #3a3a3a'
      }}>
        <h3 style={{ color: '#ffffff', fontSize: '18px', marginBottom: '15px' }}>Search & Filter</h3>
        <form onSubmit={handleLogSearch}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '15px', marginBottom: '15px' }}>
            <div>
              <label style={{ color: '#888', fontSize: '12px', display: 'block', marginBottom: '5px' }}>
                Caller Principal
              </label>
              <input
                type="text"
                placeholder="Filter by creator..."
                value={logCallerFilter}
                onChange={(e) => setLogCallerFilter(e.target.value)}
                style={{
                  width: '100%',
                  padding: '10px',
                  borderRadius: '4px',
                  border: '1px solid #3a3a3a',
                  backgroundColor: '#1a1a1a',
                  color: '#ffffff',
                  fontFamily: 'monospace',
                  fontSize: '12px'
                }}
              />
            </div>
            <div>
              <label style={{ color: '#888', fontSize: '12px', display: 'block', marginBottom: '5px' }}>
                Canister ID
              </label>
              <input
                type="text"
                placeholder="Filter by canister..."
                value={logCanisterFilter}
                onChange={(e) => setLogCanisterFilter(e.target.value)}
                style={{
                  width: '100%',
                  padding: '10px',
                  borderRadius: '4px',
                  border: '1px solid #3a3a3a',
                  backgroundColor: '#1a1a1a',
                  color: '#ffffff',
                  fontFamily: 'monospace',
                  fontSize: '12px'
                }}
              />
            </div>
            <div>
              <label style={{ color: '#888', fontSize: '12px', display: 'block', marginBottom: '5px' }}>
                From Date
              </label>
              <input
                type="date"
                value={logFromDate}
                onChange={(e) => setLogFromDate(e.target.value)}
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
                To Date
              </label>
              <input
                type="date"
                value={logToDate}
                onChange={(e) => setLogToDate(e.target.value)}
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
          <div style={{ display: 'flex', gap: '10px' }}>
            <button
              type="submit"
              disabled={creationLogLoading}
              style={{
                backgroundColor: '#3498db',
                color: '#ffffff',
                border: 'none',
                borderRadius: '4px',
                padding: '10px 20px',
                cursor: creationLogLoading ? 'not-allowed' : 'pointer',
                opacity: creationLogLoading ? 0.6 : 1
              }}
            >
              {creationLogLoading ? 'Searching...' : 'Search'}
            </button>
            <button
              type="button"
              onClick={handleLogReset}
              disabled={creationLogLoading}
              style={{
                backgroundColor: 'transparent',
                color: '#888',
                border: '1px solid #3a3a3a',
                borderRadius: '4px',
                padding: '10px 20px',
                cursor: creationLogLoading ? 'not-allowed' : 'pointer'
              }}
            >
              Reset
            </button>
          </div>
        </form>
      </div>

      {/* Results */}
      <div style={{
        backgroundColor: '#2a2a2a',
        borderRadius: '8px',
        padding: '20px',
        border: '1px solid #3a3a3a'
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '15px' }}>
          <h3 style={{ color: '#ffffff', fontSize: '18px' }}>
            Results ({creationLogTotalCount} total)
          </h3>
          <button
            onClick={() => fetchCreationLog(creationLogPage)}
            disabled={creationLogLoading}
            style={{
              backgroundColor: '#2ecc71',
              color: '#ffffff',
              border: 'none',
              borderRadius: '4px',
              padding: '8px 16px',
              cursor: creationLogLoading ? 'not-allowed' : 'pointer',
              opacity: creationLogLoading ? 0.6 : 1
            }}
          >
            {creationLogLoading ? 'Loading...' : 'Load / Refresh'}
          </button>
        </div>

        {creationLog.length === 0 ? (
          <div style={{ color: '#888', textAlign: 'center', padding: '30px' }}>
            {creationLogLoading ? 'Loading...' : 'No entries found. Click "Load / Refresh" to fetch the log.'}
          </div>
        ) : (
          <>
            {/* Log entries table */}
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid #3a3a3a' }}>
                    <th style={{ color: '#888', textAlign: 'left', padding: '10px', fontWeight: '500' }}>#</th>
                    <th style={{ color: '#888', textAlign: 'left', padding: '10px', fontWeight: '500' }}>Canister ID</th>
                    <th style={{ color: '#888', textAlign: 'left', padding: '10px', fontWeight: '500' }}>Creator</th>
                    <th style={{ color: '#888', textAlign: 'left', padding: '10px', fontWeight: '500' }}>Created At</th>
                    <th style={{ color: '#888', textAlign: 'right', padding: '10px', fontWeight: '500' }}>ICP Paid</th>
                    <th style={{ color: '#888', textAlign: 'right', padding: '10px', fontWeight: '500' }}>Profit</th>
                    <th style={{ color: '#888', textAlign: 'right', padding: '10px', fontWeight: '500' }}>Cycles</th>
                  </tr>
                </thead>
                <tbody>
                  {creationLog.map((entry, idx) => {
                    const fin = entry.financialData?.[0] || entry.financialData; // Handle optional array or direct value
                    return (
                      <tr key={idx} style={{ borderBottom: '1px solid #2a2a2a' }}>
                        <td style={{ color: '#666', padding: '10px' }}>{Number(entry.index)}</td>
                        <td style={{ padding: '10px' }}>
                          <span style={{ 
                            color: '#3498db', 
                            fontFamily: 'monospace',
                            fontSize: '12px'
                          }}>
                            {entry.canisterId.toString()}
                          </span>
                        </td>
                        <td style={{ padding: '10px' }}>
                          <span style={{ 
                            color: '#9b59b6', 
                            fontFamily: 'monospace',
                            fontSize: '12px'
                          }}>
                            {formatPrincipal(entry.caller)}
                          </span>
                        </td>
                        <td style={{ color: '#ffffff', padding: '10px' }}>
                          {formatTimestamp(entry.createdAt)}
                        </td>
                        <td style={{ color: fin ? '#2ecc71' : '#555', padding: '10px', textAlign: 'right', fontFamily: 'monospace' }}>
                          {fin ? formatIcp(fin.icpPaidE8s) : '—'}
                        </td>
                        <td style={{ color: fin ? '#f39c12' : '#555', padding: '10px', textAlign: 'right', fontFamily: 'monospace' }}>
                          {fin ? formatIcp(fin.icpProfitE8s) : '—'}
                        </td>
                        <td style={{ color: fin ? '#3498db' : '#555', padding: '10px', textAlign: 'right', fontFamily: 'monospace', fontSize: '11px' }}>
                          {fin ? formatCycles(fin.cyclesSpentOnCreation) : '—'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Pagination */}
            <div style={{ 
              display: 'flex', 
              justifyContent: 'space-between', 
              alignItems: 'center', 
              marginTop: '20px',
              paddingTop: '15px',
              borderTop: '1px solid #3a3a3a'
            }}>
              <div style={{ color: '#888', fontSize: '13px' }}>
                Showing {creationLogPage * creationLogPageSize + 1} - {Math.min((creationLogPage + 1) * creationLogPageSize, creationLogTotalCount)} of {creationLogTotalCount}
              </div>
              <div style={{ display: 'flex', gap: '10px' }}>
                <button
                  onClick={() => fetchCreationLog(creationLogPage - 1)}
                  disabled={creationLogPage === 0 || creationLogLoading}
                  style={{
                    backgroundColor: 'transparent',
                    color: creationLogPage === 0 ? '#555' : '#3498db',
                    border: `1px solid ${creationLogPage === 0 ? '#333' : '#3498db'}`,
                    borderRadius: '4px',
                    padding: '8px 16px',
                    cursor: creationLogPage === 0 || creationLogLoading ? 'not-allowed' : 'pointer'
                  }}
                >
                  ← Previous
                </button>
                <span style={{ color: '#888', padding: '8px 12px' }}>
                  Page {creationLogPage + 1}
                </span>
                <button
                  onClick={() => fetchCreationLog(creationLogPage + 1)}
                  disabled={!creationLogHasMore || creationLogLoading}
                  style={{
                    backgroundColor: 'transparent',
                    color: !creationLogHasMore ? '#555' : '#3498db',
                    border: `1px solid ${!creationLogHasMore ? '#333' : '#3498db'}`,
                    borderRadius: '4px',
                    padding: '8px 16px',
                    cursor: !creationLogHasMore || creationLogLoading ? 'not-allowed' : 'pointer'
                  }}
                >
                  Next →
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );

  const renderStats = () => (
    <div>
      <h2 style={{ color: '#ffffff', fontSize: '24px', marginBottom: '20px' }}>Factory Statistics</h2>
      <p style={{ color: '#888', fontSize: '14px', marginBottom: '20px' }}>
        Aggregate financial metrics for all canister creations. Note: Only creations after the metrics update are tracked.
      </p>
      
      {/* Load Stats Button */}
      <div style={{ marginBottom: '20px' }}>
        <button
          onClick={fetchFactoryAggregates}
          disabled={statsLoading}
          style={{
            backgroundColor: '#3498db',
            color: '#ffffff',
            border: 'none',
            borderRadius: '4px',
            padding: '12px 24px',
            cursor: statsLoading ? 'not-allowed' : 'pointer',
            opacity: statsLoading ? 0.6 : 1,
            fontSize: '16px'
          }}
        >
          {statsLoading ? 'Loading...' : 'Load Statistics'}
        </button>
      </div>

      {factoryAggregates ? (
        <>
          {/* Summary Cards */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
            gap: '20px',
            marginBottom: '30px'
          }}>
            {/* Total Canisters */}
            <div style={{
              backgroundColor: '#2a2a2a',
              borderRadius: '8px',
              padding: '20px',
              border: '1px solid #3a3a3a'
            }}>
              <div style={{ color: '#888', fontSize: '12px', marginBottom: '8px', textTransform: 'uppercase' }}>
                Total Canisters Created
              </div>
              <div style={{ color: '#3498db', fontSize: '36px', fontWeight: 'bold' }}>
                {Number(factoryAggregates.totalCanistersCreated)}
              </div>
              <div style={{ color: '#666', fontSize: '12px', marginTop: '5px' }}>
                (with financial tracking)
              </div>
            </div>

            {/* Total ICP Paid */}
            <div style={{
              backgroundColor: '#2a2a2a',
              borderRadius: '8px',
              padding: '20px',
              border: '1px solid #3a3a3a'
            }}>
              <div style={{ color: '#888', fontSize: '12px', marginBottom: '8px', textTransform: 'uppercase' }}>
                Total ICP Received
              </div>
              <div style={{ color: '#f39c12', fontSize: '36px', fontWeight: 'bold' }}>
                {(Number(factoryAggregates.totalIcpPaidE8s) / E8S).toFixed(4)}
              </div>
              <div style={{ color: '#666', fontSize: '12px', marginTop: '5px' }}>
                ICP from user payments
              </div>
            </div>

            {/* Total Profit */}
            <div style={{
              backgroundColor: '#2a2a2a',
              borderRadius: '8px',
              padding: '20px',
              border: '1px solid #2ecc71',
              background: 'linear-gradient(135deg, #2a2a2a 0%, rgba(46, 204, 113, 0.1) 100%)'
            }}>
              <div style={{ color: '#888', fontSize: '12px', marginBottom: '8px', textTransform: 'uppercase' }}>
                Total Profit
              </div>
              <div style={{ color: '#2ecc71', fontSize: '36px', fontWeight: 'bold' }}>
                {(Number(factoryAggregates.totalIcpProfitE8s) / E8S).toFixed(4)}
              </div>
              <div style={{ color: '#666', fontSize: '12px', marginTop: '5px' }}>
                ICP sent to fee destination
              </div>
            </div>
          </div>

          {/* Detailed Breakdown */}
          <div style={{
            backgroundColor: '#2a2a2a',
            borderRadius: '8px',
            padding: '20px',
            marginBottom: '20px',
            border: '1px solid #3a3a3a'
          }}>
            <h3 style={{ color: '#ffffff', fontSize: '18px', marginBottom: '20px' }}>ICP Breakdown</h3>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '20px' }}>
              <div>
                <div style={{ color: '#888', fontSize: '12px', marginBottom: '5px' }}>Total ICP Paid by Users</div>
                <div style={{ color: '#f39c12', fontSize: '20px', fontWeight: 'bold' }}>
                  {(Number(factoryAggregates.totalIcpPaidE8s) / E8S).toFixed(4)} ICP
                </div>
              </div>
              <div>
                <div style={{ color: '#888', fontSize: '12px', marginBottom: '5px' }}>ICP Used for Cycles</div>
                <div style={{ color: '#9b59b6', fontSize: '20px', fontWeight: 'bold' }}>
                  {(Number(factoryAggregates.totalIcpForCyclesE8s) / E8S).toFixed(4)} ICP
                </div>
              </div>
              <div>
                <div style={{ color: '#888', fontSize: '12px', marginBottom: '5px' }}>ICP Profit (Fee Destination)</div>
                <div style={{ color: '#2ecc71', fontSize: '20px', fontWeight: 'bold' }}>
                  {(Number(factoryAggregates.totalIcpProfitE8s) / E8S).toFixed(4)} ICP
                </div>
              </div>
              <div>
                <div style={{ color: '#888', fontSize: '12px', marginBottom: '5px' }}>ICP for Transfer Fees</div>
                <div style={{ color: '#e74c3c', fontSize: '20px', fontWeight: 'bold' }}>
                  {(Number(factoryAggregates.totalIcpTransferFeesE8s) / E8S).toFixed(4)} ICP
                </div>
              </div>
            </div>
          </div>

          {/* Cycles Breakdown */}
          <div style={{
            backgroundColor: '#2a2a2a',
            borderRadius: '8px',
            padding: '20px',
            border: '1px solid #3a3a3a'
          }}>
            <h3 style={{ color: '#ffffff', fontSize: '18px', marginBottom: '20px' }}>Cycles Breakdown</h3>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: '20px' }}>
              <div>
                <div style={{ color: '#888', fontSize: '12px', marginBottom: '5px' }}>Total Cycles Received from CMC</div>
                <div style={{ color: '#2ecc71', fontSize: '20px', fontWeight: 'bold' }}>
                  {formatCycles(factoryAggregates.totalCyclesReceivedFromCmc)}
                </div>
                <div style={{ color: '#666', fontSize: '11px', marginTop: '3px' }}>
                  {Number(factoryAggregates.totalCyclesReceivedFromCmc).toLocaleString()} cycles
                </div>
              </div>
              <div>
                <div style={{ color: '#888', fontSize: '12px', marginBottom: '5px' }}>Total Cycles Spent on Creation</div>
                <div style={{ color: '#e74c3c', fontSize: '20px', fontWeight: 'bold' }}>
                  {formatCycles(factoryAggregates.totalCyclesSpentOnCreation)}
                </div>
                <div style={{ color: '#666', fontSize: '11px', marginTop: '3px' }}>
                  {Number(factoryAggregates.totalCyclesSpentOnCreation).toLocaleString()} cycles
                </div>
              </div>
              <div>
                <div style={{ color: '#888', fontSize: '12px', marginBottom: '5px' }}>Net Cycles (Received - Spent)</div>
                <div style={{ 
                  color: Number(factoryAggregates.totalCyclesReceivedFromCmc) >= Number(factoryAggregates.totalCyclesSpentOnCreation) ? '#2ecc71' : '#e74c3c', 
                  fontSize: '20px', 
                  fontWeight: 'bold' 
                }}>
                  {formatCycles(Number(factoryAggregates.totalCyclesReceivedFromCmc) - Number(factoryAggregates.totalCyclesSpentOnCreation))}
                </div>
                <div style={{ color: '#666', fontSize: '11px', marginTop: '3px' }}>
                  {(Number(factoryAggregates.totalCyclesReceivedFromCmc) - Number(factoryAggregates.totalCyclesSpentOnCreation)).toLocaleString()} cycles
                </div>
              </div>
            </div>
          </div>

          {/* Per-Canister Averages */}
          {Number(factoryAggregates.totalCanistersCreated) > 0 && (
            <div style={{
              backgroundColor: '#2a2a2a',
              borderRadius: '8px',
              padding: '20px',
              marginTop: '20px',
              border: '1px solid #3a3a3a'
            }}>
              <h3 style={{ color: '#ffffff', fontSize: '18px', marginBottom: '20px' }}>Per-Canister Averages</h3>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '20px' }}>
                <div>
                  <div style={{ color: '#888', fontSize: '12px', marginBottom: '5px' }}>Avg ICP Paid</div>
                  <div style={{ color: '#f39c12', fontSize: '18px', fontWeight: 'bold' }}>
                    {(Number(factoryAggregates.totalIcpPaidE8s) / Number(factoryAggregates.totalCanistersCreated) / E8S).toFixed(4)} ICP
                  </div>
                </div>
                <div>
                  <div style={{ color: '#888', fontSize: '12px', marginBottom: '5px' }}>Avg Profit</div>
                  <div style={{ color: '#2ecc71', fontSize: '18px', fontWeight: 'bold' }}>
                    {(Number(factoryAggregates.totalIcpProfitE8s) / Number(factoryAggregates.totalCanistersCreated) / E8S).toFixed(4)} ICP
                  </div>
                </div>
                <div>
                  <div style={{ color: '#888', fontSize: '12px', marginBottom: '5px' }}>Avg Cycles Used</div>
                  <div style={{ color: '#9b59b6', fontSize: '18px', fontWeight: 'bold' }}>
                    {formatCycles(Number(factoryAggregates.totalCyclesSpentOnCreation) / Number(factoryAggregates.totalCanistersCreated))}
                  </div>
                </div>
              </div>
            </div>
          )}
        </>
      ) : (
        <div style={{
          backgroundColor: '#2a2a2a',
          borderRadius: '8px',
          padding: '40px',
          border: '1px solid #3a3a3a',
          textAlign: 'center'
        }}>
          <div style={{ color: '#888', fontSize: '16px' }}>
            {statsLoading ? 'Loading statistics...' : 'Click "Load Statistics" to fetch factory aggregate data'}
          </div>
          <div style={{ color: '#666', fontSize: '13px', marginTop: '10px' }}>
            Note: Statistics are only available for factory deployments that include financial tracking.
          </div>
        </div>
      )}
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
          {['config', 'admins', 'operations', 'managers', 'versions', 'log', 'stats'].map(tab => (
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
              {tab === 'versions' && 'Versions'}
              {tab === 'log' && 'Creation Log'}
              {tab === 'stats' && '📊 Stats'}
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
            {activeTab === 'versions' && renderVersions()}
            {activeTab === 'log' && renderCreationLog()}
            {activeTab === 'stats' && renderStats()}
          </>
        )}
      </main>
    </div>
  );
}

