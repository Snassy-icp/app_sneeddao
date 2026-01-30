import React, { useMemo, useState } from 'react';
import { Principal } from '@dfinity/principal';
import { Link } from 'react-router-dom';
import { useAuth } from '../AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import Header from '../components/Header';
import PrincipalInput from '../components/PrincipalInput';
import NeuronInput from '../components/NeuronInput';
import { PrincipalDisplay, getPrincipalDisplayInfoFromContext } from '../utils/PrincipalUtils';
import { useNaming } from '../NamingContext';
import { setPrincipalNickname, setNeuronNickname } from '../utils/BackendUtils';
import { useSns } from '../contexts/SnsContext';
import { FaAddressBook, FaUser, FaBrain, FaSearch, FaPlus, FaEdit, FaTrash, FaTimes, FaCheck, FaLock } from 'react-icons/fa';

// Custom CSS for animations
const customStyles = `
@keyframes fadeInUp {
    from {
        opacity: 0;
        transform: translateY(20px);
    }
    to {
        opacity: 1;
        transform: translateY(0);
    }
}

@keyframes float {
    0%, 100% { transform: translateY(0px); }
    50% { transform: translateY(-5px); }
}

@keyframes pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.7; }
}

.names-card-animate {
    animation: fadeInUp 0.5s ease-out forwards;
}

.names-card {
    transition: all 0.3s ease;
}

.names-card:hover {
    transform: translateY(-2px);
    box-shadow: 0 8px 30px rgba(20, 184, 166, 0.1);
}

.names-float {
    animation: float 3s ease-in-out infinite;
}

.names-pulse {
    animation: pulse 2s ease-in-out infinite;
}

.names-input {
    transition: all 0.2s ease;
}

.names-input:focus {
    border-color: #14b8a6 !important;
    box-shadow: 0 0 0 3px rgba(20, 184, 166, 0.15);
}

.names-btn {
    transition: all 0.2s ease;
}

.names-btn:hover:not(:disabled) {
    transform: translateY(-1px);
}
`;

// Accent colors for this page
const namesPrimary = '#14b8a6'; // Teal
const namesSecondary = '#0d9488'; // Darker teal
const namesAccent = '#2dd4bf'; // Light teal

const validateName = (input) => {
  if (!input.trim()) return 'Name cannot be empty';
  if (input.length > 32) return 'Name cannot be longer than 32 characters';
  const validPattern = /^[a-zA-Z0-9\s\-_.']+$/;
  if (!validPattern.test(input)) {
    return "Only letters, numbers, spaces, hyphens (-), underscores (_), dots (.), and apostrophes (') are allowed";
  }
  return '';
};

export default function Names() {
  const { identity, isAuthenticated } = useAuth();
  const { theme } = useTheme();
  const { principalNames, principalNicknames, neuronNames, neuronNicknames, fetchAllNames } = useNaming();
  const { selectedSnsRoot } = useSns();

  // Nicknames
  const [search, setSearch] = useState('');
  const [addPrincipal, setAddPrincipal] = useState('');
  const [addNickname, setAddNickname] = useState('');
  const [addError, setAddError] = useState('');
  const [savingNickname, setSavingNickname] = useState(false);
  const [editingPrincipal, setEditingPrincipal] = useState(null); // string principal id
  const [editNicknameValue, setEditNicknameValue] = useState('');

  // Neuron nicknames (scoped to selected SNS)
  const [neuronSearch, setNeuronSearch] = useState('');
  const [addNeuronId, setAddNeuronId] = useState('');
  const [addNeuronNickname, setAddNeuronNickname] = useState('');
  const [neuronAddError, setNeuronAddError] = useState('');
  const [savingNeuronNickname, setSavingNeuronNickname] = useState(false);
  const [editingNeuronKey, setEditingNeuronKey] = useState(null); // `${snsRoot}:${neuronHex}`
  const [editNeuronNicknameValue, setEditNeuronNicknameValue] = useState('');

  const nicknameEntries = useMemo(() => {
    const q = search.trim().toLowerCase();
    const rows = Array.from((principalNicknames || new Map()).entries()).map(([principalId, nickname]) => {
      const publicName = principalNames?.get?.(principalId) || '';
      const displayInfo = getPrincipalDisplayInfoFromContext(principalId, principalNames, principalNicknames);
      return { principalId, nickname, publicName, displayInfo };
    });
    const filtered = q
      ? rows.filter((r) => {
          return (
            r.principalId.toLowerCase().includes(q) ||
            (r.nickname || '').toLowerCase().includes(q) ||
            (r.publicName || '').toLowerCase().includes(q) ||
            (r.displayInfo?.name || '').toLowerCase().includes(q) ||
            (r.displayInfo?.nickname || '').toLowerCase().includes(q)
          );
        })
      : rows;
    filtered.sort((a, b) => (a.displayInfo?.nickname || a.nickname || '').localeCompare(b.displayInfo?.nickname || b.nickname || ''));
    return filtered;
  }, [principalNicknames, principalNames, search]);

  const neuronNicknameEntries = useMemo(() => {
    const q = neuronSearch.trim().toLowerCase();
    const entries = Array.from((neuronNicknames || new Map()).entries())
      .filter(([key]) => (selectedSnsRoot ? key.startsWith(`${selectedSnsRoot}:`) : true))
      .map(([key, nickname]) => {
        const [snsRoot, neuronIdHex] = key.split(':');
        const publicName = neuronNames?.get?.(key) || '';
        return { key, snsRoot, neuronIdHex, nickname, publicName };
      });

    const filtered = q
      ? entries.filter((r) => {
          return (
            (r.neuronIdHex || '').toLowerCase().includes(q) ||
            (r.nickname || '').toLowerCase().includes(q) ||
            (r.publicName || '').toLowerCase().includes(q)
          );
        })
      : entries;

    filtered.sort((a, b) => (a.nickname || '').localeCompare(b.nickname || ''));
    return filtered;
  }, [neuronNicknames, neuronNames, neuronSearch, selectedSnsRoot]);

  const addOrUpdateNickname = async (principalId, nickname) => {
    if (!identity) return;
    let principalObj;
    try {
      principalObj = Principal.fromText(principalId.trim());
    } catch {
      throw new Error('Invalid principal ID');
    }
    const err = validateName(nickname);
    if (err) throw new Error(err);
    const resp = await setPrincipalNickname(identity, principalObj, nickname.trim());
    if (!resp || !('ok' in resp)) throw new Error(resp?.err || 'Failed to set nickname');
    await fetchAllNames();
  };

  const removeNickname = async (principalId) => {
    if (!identity) return;
    const ok = window.confirm('Remove this nickname?');
    if (!ok) return;
    const resp = await setPrincipalNickname(identity, Principal.fromText(principalId), '');
    if (!resp || !('ok' in resp)) throw new Error(resp?.err || 'Failed to remove nickname');
    await fetchAllNames();
  };

  const addOrUpdateNeuronNickname = async (snsRoot, neuronIdHex, nickname) => {
    if (!identity) return;
    if (!snsRoot) throw new Error('Select a DAO/SNS first (top dropdown)');
    if (!neuronIdHex?.trim?.()) throw new Error('Neuron ID is required');
    const err = validateName(nickname);
    if (err) throw new Error(err);
    const resp = await setNeuronNickname(identity, snsRoot, neuronIdHex.trim(), nickname.trim());
    if (!resp || !('ok' in resp)) throw new Error(resp?.err || 'Failed to set neuron nickname');
    await fetchAllNames();
  };

  const removeNeuronNickname = async (snsRoot, neuronIdHex) => {
    if (!identity) return;
    const ok = window.confirm('Remove this neuron nickname?');
    if (!ok) return;
    const resp = await setNeuronNickname(identity, snsRoot, neuronIdHex, '');
    if (!resp || !('ok' in resp)) throw new Error(resp?.err || 'Failed to remove neuron nickname');
    await fetchAllNames();
  };

  const onAdd = async () => {
    setAddError('');
    setSavingNickname(true);
    try {
      await addOrUpdateNickname(addPrincipal, addNickname);
      setAddPrincipal('');
      setAddNickname('');
    } catch (e) {
      setAddError(e?.message || 'Failed');
    } finally {
      setSavingNickname(false);
    }
  };

  const styles = {
    input: {
      width: '100%',
      padding: '0.65rem 1rem',
      borderRadius: '10px',
      border: `1px solid ${theme.colors.border}`,
      backgroundColor: theme.colors.tertiaryBg,
      color: theme.colors.primaryText,
      boxSizing: 'border-box',
      fontSize: '0.95rem',
      outline: 'none'
    },
    btn: (kind = 'accent') => ({
      background: kind === 'accent' 
        ? `linear-gradient(135deg, ${namesPrimary}, ${namesSecondary})`
        : kind === 'danger' 
          ? `linear-gradient(135deg, ${theme.colors.error}, #dc2626)`
          : theme.colors.tertiaryBg,
      color: kind === 'muted' ? theme.colors.secondaryText : 'white',
      border: kind === 'muted' ? `1px solid ${theme.colors.border}` : 'none',
      borderRadius: '8px',
      padding: '0.6rem 1rem',
      cursor: 'pointer',
      fontWeight: 600,
      fontSize: '0.85rem',
      display: 'inline-flex',
      alignItems: 'center',
      gap: '0.4rem',
      boxShadow: kind === 'accent' ? `0 2px 10px ${namesPrimary}30` : 'none'
    })
  };

  if (!isAuthenticated) {
    return (
      <div className="page-container">
        <style>{customStyles}</style>
        <Header showSnsDropdown={true} />
        <main style={{ background: theme.colors.primaryGradient, minHeight: '100vh' }}>
          {/* Hero Section */}
          <div style={{
            background: `linear-gradient(135deg, ${theme.colors.primaryBg} 0%, ${namesPrimary}15 50%, ${namesSecondary}10 100%)`,
            borderBottom: `1px solid ${theme.colors.border}`,
            padding: '2rem 1.5rem',
            position: 'relative',
            overflow: 'hidden'
          }}>
            <div style={{
              position: 'absolute',
              top: '-50%',
              right: '-10%',
              width: '400px',
              height: '400px',
              background: `radial-gradient(circle, ${namesPrimary}20 0%, transparent 70%)`,
              borderRadius: '50%',
              pointerEvents: 'none'
            }} />
            <div style={{
              maxWidth: '900px',
              margin: '0 auto',
              position: 'relative',
              zIndex: 1
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '1.25rem' }}>
                <div className="names-float" style={{
                  width: '64px',
                  height: '64px',
                  minWidth: '64px',
                  borderRadius: '16px',
                  background: `linear-gradient(135deg, ${namesPrimary}, ${namesSecondary})`,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  boxShadow: `0 8px 30px ${namesPrimary}40`
                }}>
                  <FaAddressBook size={28} color="white" />
                </div>
                <div>
                  <h1 style={{ color: theme.colors.primaryText, fontSize: '2rem', fontWeight: '700', margin: 0 }}>
                    Address Book
                  </h1>
                  <p style={{ color: theme.colors.secondaryText, fontSize: '1rem', margin: '0.35rem 0 0 0' }}>
                    Manage your private principal and neuron nicknames
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* Login Required */}
          <div style={{ maxWidth: '900px', margin: '0 auto', padding: '2rem 1.5rem' }}>
            <div className="names-card-animate" style={{
              background: theme.colors.secondaryBg,
              borderRadius: '20px',
              padding: '3rem 2rem',
              textAlign: 'center',
              border: `1px solid ${theme.colors.border}`,
              opacity: 0,
              animationDelay: '0.1s'
            }}>
              <div className="names-float" style={{
                width: '80px',
                height: '80px',
                margin: '0 auto 1.5rem',
                borderRadius: '50%',
                background: `linear-gradient(135deg, ${namesPrimary}, ${namesSecondary})`,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                boxShadow: `0 8px 30px ${namesPrimary}40`
              }}>
                <FaLock size={32} color="white" />
              </div>
              <h2 style={{ color: theme.colors.primaryText, fontSize: '1.5rem', marginBottom: '1rem', fontWeight: '600' }}>
                Connect to Access
              </h2>
              <p style={{ color: theme.colors.secondaryText, maxWidth: '400px', margin: '0 auto', lineHeight: '1.6' }}>
                Connect your wallet to manage your private address book with custom nicknames for principals and neurons.
              </p>
            </div>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="page-container">
      <style>{customStyles}</style>
      <Header showSnsDropdown={true} />
      <main style={{ background: theme.colors.primaryGradient, minHeight: '100vh' }}>
        {/* Hero Section */}
        <div style={{
          background: `linear-gradient(135deg, ${theme.colors.primaryBg} 0%, ${namesPrimary}15 50%, ${namesSecondary}10 100%)`,
          borderBottom: `1px solid ${theme.colors.border}`,
          padding: '2rem 1.5rem',
          position: 'relative',
          overflow: 'hidden'
        }}>
          {/* Background decorations */}
          <div style={{
            position: 'absolute',
            top: '-50%',
            right: '-10%',
            width: '400px',
            height: '400px',
            background: `radial-gradient(circle, ${namesPrimary}20 0%, transparent 70%)`,
            borderRadius: '50%',
            pointerEvents: 'none'
          }} />
          <div style={{
            position: 'absolute',
            bottom: '-30%',
            left: '-5%',
            width: '300px',
            height: '300px',
            background: `radial-gradient(circle, ${namesSecondary}15 0%, transparent 70%)`,
            borderRadius: '50%',
            pointerEvents: 'none'
          }} />
          
          <div style={{ maxWidth: '900px', margin: '0 auto', position: 'relative', zIndex: 1 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '1.25rem', marginBottom: '1rem' }}>
              <div className="names-float" style={{
                width: '64px',
                height: '64px',
                minWidth: '64px',
                maxWidth: '64px',
                flexShrink: 0,
                borderRadius: '16px',
                background: `linear-gradient(135deg, ${namesPrimary}, ${namesSecondary})`,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                boxShadow: `0 8px 30px ${namesPrimary}40`
              }}>
                <FaAddressBook size={28} color="white" />
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <h1 style={{ color: theme.colors.primaryText, fontSize: '2rem', fontWeight: '700', margin: 0, lineHeight: '1.2' }}>
                  Address Book
                </h1>
                <p style={{ color: theme.colors.secondaryText, fontSize: '1rem', margin: '0.35rem 0 0 0' }}>
                  Manage your private principal and neuron nicknames
                </p>
              </div>
            </div>
            
            {/* Quick Stats */}
            <div style={{ display: 'flex', gap: '1.5rem', flexWrap: 'wrap' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: theme.colors.secondaryText, fontSize: '0.9rem' }}>
                <FaUser size={14} style={{ color: namesPrimary }} />
                <span><strong style={{ color: namesPrimary }}>{nicknameEntries.length}</strong> principal{nicknameEntries.length !== 1 ? 's' : ''}</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: theme.colors.secondaryText, fontSize: '0.9rem' }}>
                <FaBrain size={14} style={{ color: namesSecondary }} />
                <span><strong style={{ color: namesSecondary }}>{neuronNicknameEntries.length}</strong> neuron{neuronNicknameEntries.length !== 1 ? 's' : ''}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Main Content */}
        <div style={{ maxWidth: '900px', margin: '0 auto', padding: '2rem 1.5rem' }}>

          {/* Principal Nicknames Section */}
          <div style={{ marginBottom: '2rem' }}>
            <h2 style={{
              color: theme.colors.primaryText,
              fontSize: '1.35rem',
              fontWeight: '600',
              marginBottom: '1rem',
              display: 'flex',
              alignItems: 'center',
              gap: '0.75rem'
            }}>
              <span style={{
                width: '36px',
                height: '36px',
                borderRadius: '10px',
                background: `linear-gradient(135deg, ${namesPrimary}, ${namesSecondary})`,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center'
              }}>
                <FaUser size={16} color="white" />
              </span>
              Principal Nicknames
            </h2>

            {/* Add Form Card */}
            <div className="names-card-animate" style={{
              background: theme.colors.secondaryBg,
              borderRadius: '16px',
              padding: '1.25rem',
              border: `1px solid ${theme.colors.border}`,
              marginBottom: '1rem',
              opacity: 0,
              animationDelay: '0.1s'
            }}>
              <div style={{ color: theme.colors.mutedText, fontSize: '0.85rem', marginBottom: '1rem' }}>
                Add a private nickname for any principal. Only you can see these.
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr auto', gap: '0.75rem', alignItems: 'end' }}>
                <div>
                  <div style={{ color: theme.colors.mutedText, fontSize: '0.8rem', marginBottom: '0.4rem', fontWeight: '500' }}>Principal</div>
                  <PrincipalInput value={addPrincipal} onChange={setAddPrincipal} placeholder="Enter principal ID or search..." />
                </div>
                <div>
                  <div style={{ color: theme.colors.mutedText, fontSize: '0.8rem', marginBottom: '0.4rem', fontWeight: '500' }}>Nickname</div>
                  <input 
                    value={addNickname} 
                    onChange={(e) => setAddNickname(e.target.value)} 
                    placeholder="e.g. Alice" 
                    style={styles.input}
                    className="names-input"
                  />
                </div>
                <button type="button" onClick={onAdd} disabled={savingNickname} style={styles.btn('accent')} className="names-btn">
                  <FaPlus size={12} />
                  {savingNickname ? 'Saving…' : 'Add'}
                </button>
              </div>
              {addError && (
                <div style={{ 
                  color: theme.colors.error, 
                  marginTop: '0.75rem',
                  padding: '0.5rem 0.75rem',
                  background: `${theme.colors.error}15`,
                  borderRadius: '8px',
                  fontSize: '0.85rem'
                }}>
                  {addError}
                </div>
              )}
            </div>

            {/* Search */}
            <div style={{ position: 'relative', marginBottom: '1rem' }}>
              <FaSearch size={14} style={{
                position: 'absolute',
                left: '1rem',
                top: '50%',
                transform: 'translateY(-50%)',
                color: theme.colors.mutedText
              }} />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search by principal, public name, or nickname…"
                style={{ ...styles.input, paddingLeft: '2.5rem' }}
                className="names-input"
              />
            </div>

            {/* List */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              {nicknameEntries.length === 0 ? (
                <div className="names-card-animate" style={{
                  background: theme.colors.secondaryBg,
                  borderRadius: '14px',
                  padding: '2rem',
                  textAlign: 'center',
                  border: `1px solid ${theme.colors.border}`,
                  opacity: 0,
                  animationDelay: '0.2s'
                }}>
                  <FaUser size={32} style={{ color: theme.colors.mutedText, opacity: 0.3, marginBottom: '0.75rem' }} />
                  <div style={{ color: theme.colors.mutedText }}>No principal nicknames yet</div>
                </div>
              ) : (
                nicknameEntries.map((row, index) => (
                  <div
                    key={row.principalId}
                    className="names-card names-card-animate"
                    style={{
                      border: `1px solid ${theme.colors.border}`,
                      borderRadius: '14px',
                      padding: '1rem 1.25rem',
                      backgroundColor: theme.colors.secondaryBg,
                      opacity: 0,
                      animationDelay: `${(index + 2) * 0.05}s`
                    }}
                  >
                    <div style={{ display: 'flex', gap: '1rem', alignItems: 'center', flexWrap: 'wrap' }}>
                      <div style={{ flex: 1, minWidth: 220 }}>
                        <PrincipalDisplay
                          principal={Principal.fromText(row.principalId)}
                          displayInfo={getPrincipalDisplayInfoFromContext(row.principalId, principalNames, principalNicknames)}
                          showCopyButton={true}
                        />
                        {row.publicName && (
                          <div style={{ marginTop: '0.4rem', color: theme.colors.mutedText, fontSize: '0.8rem' }}>
                            Public: <span style={{ color: theme.colors.secondaryText }}>{row.publicName}</span>
                          </div>
                        )}
                      </div>

                      {editingPrincipal === row.principalId ? (
                        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
                          <input
                            value={editNicknameValue}
                            onChange={(e) => setEditNicknameValue(e.target.value)}
                            style={{ ...styles.input, width: '200px' }}
                            className="names-input"
                            autoFocus
                          />
                          <button
                            type="button"
                            onClick={async () => {
                              setSavingNickname(true);
                              try {
                                await addOrUpdateNickname(row.principalId, editNicknameValue);
                                setEditingPrincipal(null);
                              } catch (e) {
                                window.alert(e?.message || 'Failed to update nickname');
                              } finally {
                                setSavingNickname(false);
                              }
                            }}
                            disabled={savingNickname}
                            style={styles.btn('accent')}
                            className="names-btn"
                          >
                            <FaCheck size={12} />
                          </button>
                          <button
                            type="button"
                            onClick={() => setEditingPrincipal(null)}
                            style={styles.btn('muted')}
                            className="names-btn"
                          >
                            <FaTimes size={12} />
                          </button>
                        </div>
                      ) : (
                        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
                          <div style={{ 
                            color: namesPrimary, 
                            fontWeight: 600,
                            fontSize: '0.95rem',
                            background: `${namesPrimary}15`,
                            padding: '0.35rem 0.75rem',
                            borderRadius: '6px'
                          }}>
                            {row.nickname}
                          </div>
                          <button
                            type="button"
                            onClick={() => {
                              setEditingPrincipal(row.principalId);
                              setEditNicknameValue(row.nickname || '');
                            }}
                            style={styles.btn('muted')}
                            className="names-btn"
                            title="Edit"
                          >
                            <FaEdit size={12} />
                          </button>
                          <button
                            type="button"
                            onClick={async () => {
                              setSavingNickname(true);
                              try {
                                await removeNickname(row.principalId);
                              } catch (e) {
                                window.alert(e?.message || 'Failed to remove nickname');
                              } finally {
                                setSavingNickname(false);
                              }
                            }}
                            disabled={savingNickname}
                            style={styles.btn('danger')}
                            className="names-btn"
                            title="Remove"
                          >
                            <FaTrash size={12} />
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Neuron Nicknames Section */}
          <div style={{ marginBottom: '2rem' }}>
            <h2 style={{
              color: theme.colors.primaryText,
              fontSize: '1.35rem',
              fontWeight: '600',
              marginBottom: '1rem',
              display: 'flex',
              alignItems: 'center',
              gap: '0.75rem'
            }}>
              <span style={{
                width: '36px',
                height: '36px',
                borderRadius: '10px',
                background: `linear-gradient(135deg, ${namesSecondary}, #0f766e)`,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center'
              }}>
                <FaBrain size={16} color="white" />
              </span>
              Neuron Nicknames
              {selectedSnsRoot && (
                <span style={{
                  fontSize: '0.75rem',
                  color: theme.colors.mutedText,
                  fontWeight: '500',
                  background: theme.colors.tertiaryBg,
                  padding: '0.25rem 0.6rem',
                  borderRadius: '6px'
                }}>
                  Scoped to selected SNS
                </span>
              )}
            </h2>

            {/* Add Form Card */}
            <div className="names-card-animate" style={{
              background: theme.colors.secondaryBg,
              borderRadius: '16px',
              padding: '1.25rem',
              border: `1px solid ${theme.colors.border}`,
              marginBottom: '1rem',
              opacity: 0,
              animationDelay: '0.15s'
            }}>
              <div style={{ color: theme.colors.mutedText, fontSize: '0.85rem', marginBottom: '1rem' }}>
                Add a private nickname for any neuron. Nicknames are scoped to the selected DAO/SNS.
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr auto', gap: '0.75rem', alignItems: 'end' }}>
                <div>
                  <div style={{ color: theme.colors.mutedText, fontSize: '0.8rem', marginBottom: '0.4rem', fontWeight: '500' }}>Neuron</div>
                  <NeuronInput
                    value={addNeuronId}
                    onChange={setAddNeuronId}
                    placeholder="Enter neuron ID or search..."
                    snsRoot={selectedSnsRoot}
                    defaultTab="private"
                  />
                </div>
                <div>
                  <div style={{ color: theme.colors.mutedText, fontSize: '0.8rem', marginBottom: '0.4rem', fontWeight: '500' }}>Nickname</div>
                  <input
                    value={addNeuronNickname}
                    onChange={(e) => setAddNeuronNickname(e.target.value)}
                    placeholder="e.g. Team treasury"
                    style={styles.input}
                    className="names-input"
                  />
                </div>
                <button
                  type="button"
                  onClick={async () => {
                    setNeuronAddError('');
                    setSavingNeuronNickname(true);
                    try {
                      await addOrUpdateNeuronNickname(selectedSnsRoot, addNeuronId, addNeuronNickname);
                      setAddNeuronId('');
                      setAddNeuronNickname('');
                    } catch (e) {
                      setNeuronAddError(e?.message || 'Failed');
                    } finally {
                      setSavingNeuronNickname(false);
                    }
                  }}
                  disabled={savingNeuronNickname}
                  style={styles.btn('accent')}
                  className="names-btn"
                >
                  <FaPlus size={12} />
                  {savingNeuronNickname ? 'Saving…' : 'Add'}
                </button>
              </div>
              {neuronAddError && (
                <div style={{ 
                  color: theme.colors.error, 
                  marginTop: '0.75rem',
                  padding: '0.5rem 0.75rem',
                  background: `${theme.colors.error}15`,
                  borderRadius: '8px',
                  fontSize: '0.85rem'
                }}>
                  {neuronAddError}
                </div>
              )}
            </div>

            {/* Search */}
            <div style={{ position: 'relative', marginBottom: '1rem' }}>
              <FaSearch size={14} style={{
                position: 'absolute',
                left: '1rem',
                top: '50%',
                transform: 'translateY(-50%)',
                color: theme.colors.mutedText
              }} />
              <input
                value={neuronSearch}
                onChange={(e) => setNeuronSearch(e.target.value)}
                placeholder="Search by neuron ID, public name, or nickname…"
                style={{ ...styles.input, paddingLeft: '2.5rem' }}
                className="names-input"
              />
            </div>

            {/* List */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              {neuronNicknameEntries.length === 0 ? (
                <div className="names-card-animate" style={{
                  background: theme.colors.secondaryBg,
                  borderRadius: '14px',
                  padding: '2rem',
                  textAlign: 'center',
                  border: `1px solid ${theme.colors.border}`,
                  opacity: 0,
                  animationDelay: '0.2s'
                }}>
                  <FaBrain size={32} style={{ color: theme.colors.mutedText, opacity: 0.3, marginBottom: '0.75rem' }} />
                  <div style={{ color: theme.colors.mutedText }}>No neuron nicknames yet</div>
                </div>
              ) : (
                neuronNicknameEntries.map((row, index) => (
                  <div
                    key={row.key}
                    className="names-card names-card-animate"
                    style={{
                      border: `1px solid ${theme.colors.border}`,
                      borderRadius: '14px',
                      padding: '1rem 1.25rem',
                      backgroundColor: theme.colors.secondaryBg,
                      opacity: 0,
                      animationDelay: `${(index + 3) * 0.05}s`
                    }}
                  >
                    <div style={{ display: 'flex', gap: '1rem', alignItems: 'center', flexWrap: 'wrap' }}>
                      <div style={{ flex: 1, minWidth: 220 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap', marginBottom: '0.3rem' }}>
                          <Link
                            to={`/neuron?neuronid=${row.neuronIdHex}&sns=${row.snsRoot}`}
                            style={{ 
                              color: theme.colors.accent, 
                              textDecoration: 'none', 
                              fontFamily: 'monospace',
                              fontSize: '0.9rem',
                              fontWeight: '500'
                            }}
                            title={row.neuronIdHex}
                          >
                            {`${row.neuronIdHex.slice(0, 8)}...${row.neuronIdHex.slice(-8)}`}
                          </Link>
                        </div>
                        <div style={{ color: theme.colors.mutedText, fontSize: '0.75rem' }}>
                          SNS: {row.snsRoot.slice(0, 10)}…{row.snsRoot.slice(-5)}
                        </div>
                        {row.publicName && (
                          <div style={{ marginTop: '0.3rem', color: theme.colors.mutedText, fontSize: '0.8rem' }}>
                            Public: <span style={{ color: theme.colors.secondaryText }}>{row.publicName}</span>
                          </div>
                        )}
                      </div>

                      {editingNeuronKey === row.key ? (
                        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
                          <input
                            value={editNeuronNicknameValue}
                            onChange={(e) => setEditNeuronNicknameValue(e.target.value)}
                            style={{ ...styles.input, width: '200px' }}
                            className="names-input"
                            autoFocus
                          />
                          <button
                            type="button"
                            onClick={async () => {
                              setSavingNeuronNickname(true);
                              try {
                                await addOrUpdateNeuronNickname(row.snsRoot, row.neuronIdHex, editNeuronNicknameValue);
                                setEditingNeuronKey(null);
                              } catch (e) {
                                window.alert(e?.message || 'Failed to update neuron nickname');
                              } finally {
                                setSavingNeuronNickname(false);
                              }
                            }}
                            disabled={savingNeuronNickname}
                            style={styles.btn('accent')}
                            className="names-btn"
                          >
                            <FaCheck size={12} />
                          </button>
                          <button 
                            type="button" 
                            onClick={() => setEditingNeuronKey(null)} 
                            style={styles.btn('muted')}
                            className="names-btn"
                          >
                            <FaTimes size={12} />
                          </button>
                        </div>
                      ) : (
                        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
                          <div style={{ 
                            color: namesSecondary, 
                            fontWeight: 600,
                            fontSize: '0.95rem',
                            background: `${namesSecondary}15`,
                            padding: '0.35rem 0.75rem',
                            borderRadius: '6px'
                          }}>
                            {row.nickname}
                          </div>
                          <button
                            type="button"
                            onClick={() => {
                              setEditingNeuronKey(row.key);
                              setEditNeuronNicknameValue(row.nickname || '');
                            }}
                            style={styles.btn('muted')}
                            className="names-btn"
                            title="Edit"
                          >
                            <FaEdit size={12} />
                          </button>
                          <button
                            type="button"
                            onClick={async () => {
                              setSavingNeuronNickname(true);
                              try {
                                await removeNeuronNickname(row.snsRoot, row.neuronIdHex);
                              } catch (e) {
                                window.alert(e?.message || 'Failed to remove neuron nickname');
                              } finally {
                                setSavingNeuronNickname(false);
                              }
                            }}
                            disabled={savingNeuronNickname}
                            style={styles.btn('danger')}
                            className="names-btn"
                            title="Remove"
                          >
                            <FaTrash size={12} />
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}

