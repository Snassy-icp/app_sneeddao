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
    card: {
      backgroundColor: theme.colors.secondaryBg,
      border: `1px solid ${theme.colors.border}`,
      borderRadius: '12px',
      padding: '20px',
      marginBottom: '20px'
    },
    title: { color: theme.colors.primaryText, margin: '0 0 8px 0' },
    muted: { color: theme.colors.mutedText },
    input: {
      width: '100%',
      padding: '10px',
      borderRadius: '8px',
      border: `1px solid ${theme.colors.border}`,
      backgroundColor: theme.colors.tertiaryBg,
      color: theme.colors.primaryText,
      boxSizing: 'border-box'
    },
    btn: (kind = 'accent') => ({
      backgroundColor: kind === 'accent' ? theme.colors.accent : kind === 'danger' ? theme.colors.error : theme.colors.mutedText,
      color: theme.colors.primaryText,
      border: 'none',
      borderRadius: '8px',
      padding: '10px 14px',
      cursor: 'pointer',
      fontWeight: 600
    })
  };

  if (!isAuthenticated) {
    return (
      <div className="page-container" style={{ background: theme.colors.primaryGradient, minHeight: '100vh' }}>
        <Header showSnsDropdown={true} />
        <main className="wallet-container">
          <div style={styles.card}>
            <h2 style={styles.title}>Address Book</h2>
            <div style={styles.muted}>Connect your wallet to manage your private address book (principals and neurons).</div>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="page-container" style={{ background: theme.colors.primaryGradient, minHeight: '100vh' }}>
      <Header showSnsDropdown={true} />
      <main className="wallet-container">
        <div style={{ marginBottom: '16px' }}>
          <h1 style={{ color: theme.colors.primaryText, margin: 0 }}>Address Book</h1>
          <div style={{ color: theme.colors.mutedText, marginTop: '6px' }}>
            Manage your private <strong>principal</strong> and <strong>neuron</strong> nicknames.
          </div>
        </div>

        {/* Principal nicknames */}
        <div style={styles.card}>
          <h2 style={styles.title}>Principal nicknames</h2>
          <div style={{ color: theme.colors.mutedText, marginBottom: '12px' }}>
            These nicknames are private to you.
          </div>

          {/* Add nickname */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr auto', gap: '10px', alignItems: 'end' }}>
            <div>
              <div style={{ color: theme.colors.mutedText, fontSize: '13px', marginBottom: '6px' }}>Principal</div>
              <PrincipalInput value={addPrincipal} onChange={setAddPrincipal} placeholder="Enter principal ID or search by name" />
            </div>
            <div>
              <div style={{ color: theme.colors.mutedText, fontSize: '13px', marginBottom: '6px' }}>Nickname</div>
              <input value={addNickname} onChange={(e) => setAddNickname(e.target.value)} placeholder="e.g. Alice" style={styles.input} />
            </div>
            <button type="button" onClick={onAdd} disabled={savingNickname} style={styles.btn('accent')}>
              {savingNickname ? 'Saving…' : 'Add'}
            </button>
          </div>
          {addError && <div style={{ color: theme.colors.error, marginTop: '10px' }}>{addError}</div>}

          {/* Search */}
          <div style={{ marginTop: '16px' }}>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by principal, public name, or nickname…"
              style={styles.input}
            />
          </div>

          {/* List */}
          <div style={{ marginTop: '16px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {nicknameEntries.length === 0 ? (
              <div style={{ color: theme.colors.mutedText }}>No nicknames yet.</div>
            ) : (
              nicknameEntries.map((row) => (
                <div
                  key={row.principalId}
                  style={{
                    border: `1px solid ${theme.colors.border}`,
                    borderRadius: '10px',
                    padding: '12px',
                    backgroundColor: theme.colors.primaryBg
                  }}
                >
                  <div style={{ display: 'flex', gap: '12px', alignItems: 'center', flexWrap: 'wrap' }}>
                    <div style={{ flex: 1, minWidth: 260 }}>
                      <PrincipalDisplay
                        principal={Principal.fromText(row.principalId)}
                        displayInfo={getPrincipalDisplayInfoFromContext(row.principalId, principalNames, principalNicknames)}
                        showCopyButton={true}
                      />
                      {row.publicName && (
                        <div style={{ marginTop: '6px', color: theme.colors.mutedText, fontSize: '12px' }}>
                          Public name: <span style={{ color: theme.colors.primaryText }}>{row.publicName}</span>
                        </div>
                      )}
                    </div>

                    {editingPrincipal === row.principalId ? (
                      <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
                        <input
                          value={editNicknameValue}
                          onChange={(e) => setEditNicknameValue(e.target.value)}
                          style={{ ...styles.input, width: '260px' }}
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
                        >
                          Save
                        </button>
                        <button
                          type="button"
                          onClick={() => setEditingPrincipal(null)}
                          style={styles.btn('muted')}
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
                        <div style={{ color: theme.colors.primaryText, fontWeight: 700 }}>{row.nickname}</div>
                        <button
                          type="button"
                          onClick={() => {
                            setEditingPrincipal(row.principalId);
                            setEditNicknameValue(row.nickname || '');
                          }}
                          style={styles.btn('muted')}
                        >
                          Edit
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
                        >
                          Remove
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Neuron nicknames */}
        <div style={styles.card}>
          <h2 style={styles.title}>Neuron nicknames</h2>
          <div style={{ color: theme.colors.mutedText, marginBottom: '12px' }}>
            These nicknames are private to you and are scoped to the selected DAO/SNS in the top dropdown.
          </div>

          {/* Add neuron nickname */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr auto', gap: '10px', alignItems: 'end' }}>
            <div>
              <div style={{ color: theme.colors.mutedText, fontSize: '13px', marginBottom: '6px' }}>Neuron</div>
              <NeuronInput
                value={addNeuronId}
                onChange={setAddNeuronId}
                placeholder="Enter neuron ID or search by nickname/name"
                snsRoot={selectedSnsRoot}
                defaultTab="private"
              />
            </div>
            <div>
              <div style={{ color: theme.colors.mutedText, fontSize: '13px', marginBottom: '6px' }}>Nickname</div>
              <input
                value={addNeuronNickname}
                onChange={(e) => setAddNeuronNickname(e.target.value)}
                placeholder="e.g. Team treasury neuron"
                style={styles.input}
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
            >
              {savingNeuronNickname ? 'Saving…' : 'Add'}
            </button>
          </div>
          {neuronAddError && <div style={{ color: theme.colors.error, marginTop: '10px' }}>{neuronAddError}</div>}

          {/* Search */}
          <div style={{ marginTop: '16px' }}>
            <input
              value={neuronSearch}
              onChange={(e) => setNeuronSearch(e.target.value)}
              placeholder="Search by neuron ID, public name, or nickname…"
              style={styles.input}
            />
          </div>

          {/* List */}
          <div style={{ marginTop: '16px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {neuronNicknameEntries.length === 0 ? (
              <div style={{ color: theme.colors.mutedText }}>No neuron nicknames yet.</div>
            ) : (
              neuronNicknameEntries.map((row) => (
                <div
                  key={row.key}
                  style={{
                    border: `1px solid ${theme.colors.border}`,
                    borderRadius: '10px',
                    padding: '12px',
                    backgroundColor: theme.colors.primaryBg
                  }}
                >
                  <div style={{ display: 'flex', gap: '12px', alignItems: 'center', flexWrap: 'wrap' }}>
                    <div style={{ flex: 1, minWidth: 260 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
                        <Link
                          to={`/neuron?neuronid=${row.neuronIdHex}&sns=${row.snsRoot}`}
                          style={{ color: theme.colors.accent, textDecoration: 'none', fontFamily: 'monospace' }}
                          title={row.neuronIdHex}
                        >
                          {`${row.neuronIdHex.slice(0, 6)}...${row.neuronIdHex.slice(-6)}`}
                        </Link>
                        <span style={{ color: theme.colors.mutedText, fontSize: '12px' }}>
                          SNS: {row.snsRoot.slice(0, 6)}…{row.snsRoot.slice(-6)}
                        </span>
                      </div>
                      {row.publicName && (
                        <div style={{ marginTop: '6px', color: theme.colors.mutedText, fontSize: '12px' }}>
                          Public name: <span style={{ color: theme.colors.primaryText }}>{row.publicName}</span>
                        </div>
                      )}
                    </div>

                    {editingNeuronKey === row.key ? (
                      <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
                        <input
                          value={editNeuronNicknameValue}
                          onChange={(e) => setEditNeuronNicknameValue(e.target.value)}
                          style={{ ...styles.input, width: '260px' }}
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
                        >
                          Save
                        </button>
                        <button type="button" onClick={() => setEditingNeuronKey(null)} style={styles.btn('muted')}>
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
                        <div style={{ color: theme.colors.primaryText, fontWeight: 700 }}>{row.nickname}</div>
                        <button
                          type="button"
                          onClick={() => {
                            setEditingNeuronKey(row.key);
                            setEditNeuronNicknameValue(row.nickname || '');
                          }}
                          style={styles.btn('muted')}
                        >
                          Edit
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
                        >
                          Remove
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </main>
    </div>
  );
}

