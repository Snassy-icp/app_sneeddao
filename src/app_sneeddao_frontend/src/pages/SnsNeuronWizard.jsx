import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Principal } from '@dfinity/principal';
import { createActor as createBackendActor, canisterId as backendCanisterId } from 'declarations/app_sneeddao_backend';
import Header from '../components/Header';
import { useTheme } from '../contexts/ThemeContext';
import { useSns } from '../contexts/SnsContext';
import { useAuth } from '../AuthContext';
import { fetchAndCacheSnsData, getSnsById } from '../utils/SnsUtils';

export default function SnsNeuronWizard() {
  const { theme } = useTheme();
  const { identity, isAuthenticated, login } = useAuth();
  const { selectedSnsRoot, updateSelectedSns, SNEED_SNS_ROOT } = useSns();

  const [step, setStep] = useState(0);
  const [snsList, setSnsList] = useState([]);
  const [loadingSns, setLoadingSns] = useState(false);
  const [snsLoadError, setSnsLoadError] = useState('');

  const [walletLedgerIds, setWalletLedgerIds] = useState(null); // Array<Principal>
  const [checkingWalletLedgers, setCheckingWalletLedgers] = useState(false);
  const [registeringToken, setRegisteringToken] = useState(false);
  const [registerError, setRegisterError] = useState('');

  const [userConfirmedStaked, setUserConfirmedStaked] = useState(false);

  const snsParam = useMemo(() => {
    if (!selectedSnsRoot || selectedSnsRoot === SNEED_SNS_ROOT) return '';
    return `?sns=${selectedSnsRoot}`;
  }, [selectedSnsRoot, SNEED_SNS_ROOT]);

  const selectedSns = useMemo(() => {
    if (!selectedSnsRoot) return null;
    return getSnsById(selectedSnsRoot);
  }, [selectedSnsRoot]);

  const selectedLedgerId = selectedSns?.canisters?.ledger || null;

  const isSelectedSnsValid = Boolean(selectedSnsRoot && selectedSnsRoot !== SNEED_SNS_ROOT && selectedLedgerId);

  const isTokenRegistered = useMemo(() => {
    if (!selectedLedgerId || !walletLedgerIds) return false;
    const want = selectedLedgerId.toString();
    return walletLedgerIds.some((p) => p?.toString?.() === want);
  }, [walletLedgerIds, selectedLedgerId]);

  const refreshWalletLedgers = async () => {
    if (!identity) return;
    setCheckingWalletLedgers(true);
    setRegisterError('');
    try {
      const backendActor = createBackendActor(backendCanisterId, { agentOptions: { identity } });
      const ledgers = await backendActor.get_ledger_canister_ids();
      setWalletLedgerIds(ledgers);
    } catch (e) {
      console.error('Failed to fetch wallet ledger IDs:', e);
      setRegisterError(e?.message || 'Failed to check wallet token registration');
    } finally {
      setCheckingWalletLedgers(false);
    }
  };

  const registerSelectedToken = async () => {
    if (!identity || !selectedLedgerId) return;
    setRegisteringToken(true);
    setRegisterError('');
    try {
      const backendActor = createBackendActor(backendCanisterId, { agentOptions: { identity } });
      await backendActor.register_ledger_canister_id(Principal.fromText(selectedLedgerId.toString()));
      await refreshWalletLedgers();
    } catch (e) {
      console.error('Failed to register SNS token:', e);
      setRegisterError(e?.message || 'Failed to register token');
    } finally {
      setRegisteringToken(false);
    }
  };

  useEffect(() => {
    const run = async () => {
      setLoadingSns(true);
      setSnsLoadError('');
      try {
        const data = await fetchAndCacheSnsData(identity);
        setSnsList(data || []);
      } catch (e) {
        console.error('Failed to load SNS list:', e);
        setSnsLoadError('Failed to load SNS list');
      } finally {
        setLoadingSns(false);
      }
    };
    run();
  }, [identity]);

  useEffect(() => {
    if (!identity) return;
    refreshWalletLedgers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [identity]);

  useEffect(() => {
    // If user changes SNS, reset later steps that depend on it
    setRegisterError('');
    setUserConfirmedStaked(false);
  }, [selectedSnsRoot]);

  const cardStyle = {
    backgroundColor: theme.colors.secondaryBg,
    border: `1px solid ${theme.colors.border}`,
    borderRadius: '12px',
    padding: '18px'
  };

  const panelStyle = {
    backgroundColor: theme.colors.primaryBg,
    border: `1px solid ${theme.colors.border}`,
    borderRadius: '12px',
    padding: '14px'
  };

  const btn = (kind = 'primary') => ({
    backgroundColor: kind === 'primary' ? theme.colors.accent : 'transparent',
    color: kind === 'primary' ? theme.colors.primaryBg : theme.colors.primaryText,
    border: kind === 'primary' ? 'none' : `1px solid ${theme.colors.border}`,
    padding: '10px 14px',
    borderRadius: '10px',
    textDecoration: 'none',
    fontWeight: 800,
    cursor: 'pointer'
  });

  const canGoNext = () => {
    if (step === 0) return isSelectedSnsValid;
    if (step === 1) return isSelectedSnsValid && isTokenRegistered;
    if (step === 2) return isSelectedSnsValid && userConfirmedStaked; // staking happens in Wallet
    if (step === 3) return true;
    return false;
  };

  return (
    <div className="page-container" style={{ background: theme.colors.primaryGradient, minHeight: '100vh' }}>
      <Header showSnsDropdown={true} />
      <main className="wallet-container">
        <div style={{ ...cardStyle, marginBottom: '16px' }}>
          <h1 style={{ margin: 0, color: theme.colors.primaryText }}>SNS Liquid Staking Wizard</h1>
          <div style={{ marginTop: '8px', color: theme.colors.mutedText, lineHeight: 1.5 }}>
            A guided flow to end up with a <strong>staked SNS neuron</strong>. We’ll help you pick an SNS, make sure its token is registered
            in your wallet, then guide you through staking and verification.
          </div>

          {!isAuthenticated && (
            <div style={{ marginTop: '12px', display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
              <div style={{ color: theme.colors.mutedText }}>Connect your wallet to use the wizard.</div>
              <button type="button" onClick={login} style={btn('primary')}>Connect</button>
            </div>
          )}
        </div>

        <div style={{ ...panelStyle, marginBottom: '12px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: '10px', flexWrap: 'wrap' }}>
            <div style={{ color: theme.colors.primaryText, fontWeight: 900 }}>
              Step {step + 1} / 4
            </div>
            <div style={{ display: 'flex', gap: '10px' }}>
              <button type="button" onClick={() => setStep((s) => Math.max(0, s - 1))} disabled={step === 0} style={{ ...btn('ghost'), opacity: step === 0 ? 0.5 : 1 }}>
                Back
              </button>
              <button type="button" onClick={() => setStep((s) => Math.min(3, s + 1))} disabled={!canGoNext()} style={{ ...btn('primary'), opacity: canGoNext() ? 1 : 0.6 }}>
                Next
              </button>
            </div>
          </div>
        </div>

        {step === 0 && (
          <div style={panelStyle}>
            <div style={{ color: theme.colors.primaryText, fontWeight: 900, marginBottom: '8px' }}>1) Select the SNS</div>
            <div style={{ color: theme.colors.mutedText, fontSize: '13px', lineHeight: 1.5, marginBottom: '12px' }}>
              Pick which DAO/SNS you want to stake in. This sets context across the site and controls which token we’ll register.
            </div>

            {snsLoadError && <div style={{ color: theme.colors.error, marginBottom: '10px' }}>{snsLoadError}</div>}

            <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', alignItems: 'center' }}>
              <select
                value={selectedSnsRoot || ''}
                onChange={(e) => updateSelectedSns(e.target.value)}
                disabled={!isAuthenticated || loadingSns}
                style={{
                  flex: 1,
                  minWidth: '260px',
                  padding: '10px 12px',
                  borderRadius: '10px',
                  border: `1px solid ${theme.colors.border}`,
                  backgroundColor: theme.colors.tertiaryBg,
                  color: theme.colors.primaryText
                }}
              >
                <option value="">{loadingSns ? 'Loading SNSes…' : 'Select an SNS…'}</option>
                {snsList.map((s) => (
                  <option key={s.rootCanisterId} value={s.rootCanisterId}>{s.name}</option>
                ))}
              </select>

              <Link to="/sns" style={btn('ghost')}>Browse Directory →</Link>
            </div>

            {!isSelectedSnsValid && selectedSnsRoot && (
              <div style={{ marginTop: '10px', color: theme.colors.warning }}>
                This selection doesn’t look valid yet. Please pick a real SNS (not the default) so we can find its ledger canister.
              </div>
            )}
          </div>
        )}

        {step === 1 && (
          <div style={panelStyle}>
            <div style={{ color: theme.colors.primaryText, fontWeight: 900, marginBottom: '8px' }}>2) Register the SNS token in your Wallet</div>
            <div style={{ color: theme.colors.mutedText, fontSize: '13px', lineHeight: 1.5, marginBottom: '12px' }}>
              To see your staking position in Wallet (and on your /me page), we ensure the SNS’s token ledger is registered to your wallet.
            </div>

            {!isSelectedSnsValid ? (
              <div style={{ color: theme.colors.mutedText }}>
                Pick an SNS in Step 1 first.
              </div>
            ) : (
              <>
                <div style={{ color: theme.colors.mutedText, fontSize: '13px' }}>
                  Ledger canister: <span style={{ fontFamily: 'monospace', color: theme.colors.primaryText }}>{selectedLedgerId}</span>
                </div>

                <div style={{ marginTop: '10px', display: 'flex', gap: '10px', flexWrap: 'wrap', alignItems: 'center' }}>
                  <button
                    type="button"
                    onClick={refreshWalletLedgers}
                    disabled={checkingWalletLedgers || !isAuthenticated}
                    style={{ ...btn('ghost'), opacity: (checkingWalletLedgers || !isAuthenticated) ? 0.6 : 1 }}
                  >
                    {checkingWalletLedgers ? 'Checking…' : 'Re-check Wallet'}
                  </button>
                  {!isTokenRegistered ? (
                    <button
                      type="button"
                      onClick={registerSelectedToken}
                      disabled={registeringToken || !isAuthenticated}
                      style={{ ...btn('primary'), opacity: (registeringToken || !isAuthenticated) ? 0.6 : 1 }}
                    >
                      {registeringToken ? 'Registering…' : 'Register Token'}
                    </button>
                  ) : (
                    <div style={{ color: theme.colors.success, fontWeight: 800 }}>Registered ✓</div>
                  )}
                </div>

                {registerError && <div style={{ marginTop: '10px', color: theme.colors.error }}>{registerError}</div>}
              </>
            )}
          </div>
        )}

        {step === 2 && (
          <div style={panelStyle}>
            <div style={{ color: theme.colors.primaryText, fontWeight: 900, marginBottom: '8px' }}>3) Stake the neuron</div>
            <div style={{ color: theme.colors.mutedText, fontSize: '13px', lineHeight: 1.5, marginBottom: '12px' }}>
              Staking happens in Wallet. When you’re done, come back and continue to verification.
            </div>

            <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
              <Link to={`/wallet${snsParam}`} style={btn('primary')}>Open Wallet (stake) →</Link>
              <Link to={`/neurons${snsParam}`} style={btn('ghost')}>Browse Neurons →</Link>
              <Link to={`/me`} style={btn('ghost')}>Open /me →</Link>
            </div>

            <div style={{ marginTop: '12px', display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
              <input
                id="confirm-staked"
                type="checkbox"
                checked={userConfirmedStaked}
                onChange={(e) => setUserConfirmedStaked(e.target.checked)}
              />
              <label htmlFor="confirm-staked" style={{ color: theme.colors.primaryText }}>
                I have staked a neuron for this SNS
              </label>
            </div>

            <div style={{ marginTop: '10px', color: theme.colors.mutedText, fontSize: '12px' }}>
              Tip: After staking, you should see the token in Wallet and your neurons in /me and /neurons.
            </div>

            <div style={{ marginTop: '12px', color: userConfirmedStaked ? theme.colors.success : theme.colors.warning, fontSize: '13px' }}>
              {userConfirmedStaked ? 'Great — you can continue.' : 'Check the box once you’ve completed staking in Wallet.'}
            </div>
          </div>
        )}

        {step === 3 && (
          <div style={panelStyle}>
            <div style={{ color: theme.colors.primaryText, fontWeight: 900, marginBottom: '8px' }}>4) Verify + next actions</div>
            <div style={{ color: theme.colors.mutedText, fontSize: '13px', lineHeight: 1.5, marginBottom: '12px' }}>
              Confirm your neuron is visible, then optionally move into governance or marketplace workflows.
            </div>
            <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
              <Link to={`/me`} style={btn('primary')}>View on /me →</Link>
              <Link to={`/neurons${snsParam}`} style={btn('ghost')}>View on /neurons →</Link>
              <Link to={`/proposals${snsParam}`} style={btn('ghost')}>Open Proposals →</Link>
              <Link to={`/forum${snsParam}`} style={btn('ghost')}>Open Forum →</Link>
              <Link to="/sneedex_offers" style={btn('ghost')}>Browse Sneedex →</Link>
            </div>
            <div style={{ marginTop: '12px', color: theme.colors.mutedText, fontSize: '12px' }}>
              You can also create/trade ICP Neuron Manager canisters via Liquid Staking.
              {' '}
              <Link to="/liquid_staking" style={{ color: theme.colors.accent, textDecoration: 'none' }}>Open Liquid Staking →</Link>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

