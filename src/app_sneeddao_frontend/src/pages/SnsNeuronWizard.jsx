import React, { useMemo } from 'react';
import { Link } from 'react-router-dom';
import Header from '../components/Header';
import { useTheme } from '../contexts/ThemeContext';
import { useSns } from '../contexts/SnsContext';

export default function SnsNeuronWizard() {
  const { theme } = useTheme();
  const { selectedSnsRoot, SNEED_SNS_ROOT } = useSns();

  const snsParam = useMemo(() => {
    if (!selectedSnsRoot || selectedSnsRoot === SNEED_SNS_ROOT) return '';
    return `?sns=${selectedSnsRoot}`;
  }, [selectedSnsRoot, SNEED_SNS_ROOT]);

  const cardStyle = {
    backgroundColor: theme.colors.secondaryBg,
    border: `1px solid ${theme.colors.border}`,
    borderRadius: '12px',
    padding: '18px'
  };

  const stepStyle = {
    backgroundColor: theme.colors.primaryBg,
    border: `1px solid ${theme.colors.border}`,
    borderRadius: '12px',
    padding: '14px'
  };

  const btn = {
    backgroundColor: theme.colors.accent,
    color: theme.colors.primaryBg,
    padding: '10px 14px',
    borderRadius: '10px',
    textDecoration: 'none',
    fontWeight: 800,
    display: 'inline-block'
  };

  const ghostBtn = {
    backgroundColor: 'transparent',
    color: theme.colors.primaryText,
    border: `1px solid ${theme.colors.border}`,
    padding: '10px 14px',
    borderRadius: '10px',
    textDecoration: 'none',
    fontWeight: 800,
    display: 'inline-block'
  };

  return (
    <div className="page-container" style={{ background: theme.colors.primaryGradient, minHeight: '100vh' }}>
      <Header showSnsDropdown={true} />
      <main className="wallet-container">
        <div style={{ ...cardStyle, marginBottom: '16px' }}>
          <h1 style={{ margin: 0, color: theme.colors.primaryText }}>SNS Liquid Staking Wizard</h1>
          <div style={{ marginTop: '8px', color: theme.colors.mutedText, lineHeight: 1.5 }}>
            This wizard guides you through creating an SNS neuron using the existing Wallet + Neuron pages.
            Use the SNS dropdown above to pick the DAO you’re working with.
          </div>
          {selectedSnsRoot && selectedSnsRoot !== SNEED_SNS_ROOT && (
            <div style={{ marginTop: '10px', color: theme.colors.mutedText, fontSize: '13px' }}>
              Current SNS context: <span style={{ fontFamily: 'monospace', color: theme.colors.primaryText }}>{selectedSnsRoot}</span>
            </div>
          )}
        </div>

        <div style={{ display: 'grid', gap: '12px' }}>
          <div style={stepStyle}>
            <div style={{ color: theme.colors.primaryText, fontWeight: 900, marginBottom: '6px' }}>1) Choose an SNS</div>
            <div style={{ color: theme.colors.mutedText, fontSize: '13px', lineHeight: 1.5 }}>
              Pick the DAO/SNS you want using the dropdown in the header. The buttons below will carry that context into the next pages.
            </div>
          </div>

          <div style={stepStyle}>
            <div style={{ color: theme.colors.primaryText, fontWeight: 900, marginBottom: '6px' }}>2) Stake an SNS neuron (Wallet)</div>
            <div style={{ color: theme.colors.mutedText, fontSize: '13px', lineHeight: 1.5 }}>
              Stake from the Wallet. Once created, you can manage and inspect the neuron in the Neuron page.
            </div>
            <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', marginTop: '10px' }}>
              <Link to={`/wallet${snsParam}`} style={btn}>Open Wallet (stake) →</Link>
              <Link to={`/neurons${snsParam}`} style={ghostBtn}>Browse Neurons →</Link>
            </div>
          </div>

          <div style={stepStyle}>
            <div style={{ color: theme.colors.primaryText, fontWeight: 900, marginBottom: '6px' }}>3) Manage the neuron</div>
            <div style={{ color: theme.colors.mutedText, fontSize: '13px', lineHeight: 1.5 }}>
              Use the Neuron page to manage dissolve delay, voting, and other controls.
            </div>
            <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', marginTop: '10px' }}>
              <Link to={`/neuron${snsParam}`} style={btn}>Open Neuron Page →</Link>
              <Link to={`/proposals${snsParam}`} style={ghostBtn}>Open Proposals →</Link>
              <Link to={`/forum${snsParam}`} style={ghostBtn}>Open Forum →</Link>
            </div>
          </div>

          <div style={stepStyle}>
            <div style={{ color: theme.colors.primaryText, fontWeight: 900, marginBottom: '6px' }}>4) Trade on Sneedex</div>
            <div style={{ color: theme.colors.mutedText, fontSize: '13px', lineHeight: 1.5 }}>
              Liquid staking is designed to be compatible with marketplace trading. You can also trade ICP Neuron Manager canisters on Sneedex.
            </div>
            <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', marginTop: '10px' }}>
              <Link to="/sneedex_offers" style={btn}>Browse Sneedex →</Link>
              <Link to="/create_icp_neuron" style={ghostBtn}>Create ICP Neuron Manager →</Link>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}

