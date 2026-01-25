import React from 'react';
import { Link } from 'react-router-dom';
import Header from '../components/Header';
import { useTheme } from '../contexts/ThemeContext';

export default function LiquidStaking() {
  const { theme } = useTheme();

  const cardStyle = {
    backgroundColor: theme.colors.secondaryBg,
    border: `1px solid ${theme.colors.border}`,
    borderRadius: '12px',
    padding: '18px'
  };

  const primaryBtn = {
    backgroundColor: theme.colors.accent,
    color: theme.colors.primaryBg,
    padding: '10px 14px',
    borderRadius: '10px',
    textDecoration: 'none',
    fontWeight: 800
  };

  const secondaryBtn = {
    backgroundColor: `${theme.colors.success}15`,
    color: theme.colors.success,
    border: `1px solid ${theme.colors.success}55`,
    padding: '10px 14px',
    borderRadius: '10px',
    textDecoration: 'none',
    fontWeight: 800
  };

  return (
    <div className="page-container" style={{ background: theme.colors.primaryGradient, minHeight: '100vh' }}>
      <Header showSnsDropdown={true} />
      <main className="wallet-container">
        <div style={{ ...cardStyle, marginBottom: '16px' }}>
          <h1 style={{ margin: 0, color: theme.colors.primaryText }}>Liquid Staking</h1>
          <div style={{ marginTop: '8px', color: theme.colors.mutedText, lineHeight: 1.5 }}>
            On Sneed, “liquid staking” means you can create staking positions that are <strong>transferable</strong> and can be
            <strong> traded on Sneedex</strong>.
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '12px' }}>
          <div style={cardStyle}>
            <div style={{ color: theme.colors.primaryText, fontWeight: 900, marginBottom: '6px' }}>🧠 ICP Neuron Managers</div>
            <div style={{ color: theme.colors.mutedText, fontSize: '13px', lineHeight: 1.5 }}>
              Deploy a neuron manager canister and manage multiple ICP neurons in one place. These canisters can be traded on Sneedex.
            </div>
            <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', marginTop: '12px' }}>
              <Link to="/create_icp_neuron" style={primaryBtn}>Create ICP Neuron Manager →</Link>
              <Link to="/sneedex_offers" style={secondaryBtn}>Browse Sneedex →</Link>
            </div>
          </div>

          <div style={cardStyle}>
            <div style={{ color: theme.colors.primaryText, fontWeight: 900, marginBottom: '6px' }}>🧬 Transferable SNS Neurons</div>
            <div style={{ color: theme.colors.mutedText, fontSize: '13px', lineHeight: 1.5 }}>
              Create SNS staking positions designed to be transferable and tradable on Sneedex. You can already stake from the Wallet
              and manage neurons in the Neuron page—this wizard helps guide the flow.
            </div>
            <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', marginTop: '12px' }}>
              <Link to="/sns_neuron_wizard" style={primaryBtn}>Open SNS Wizard →</Link>
              <Link to="/wallet" style={secondaryBtn}>Open Wallet →</Link>
              <Link to="/neuron" style={secondaryBtn}>Open Neuron Page →</Link>
            </div>
          </div>
        </div>

        <div style={{ ...cardStyle, marginTop: '12px' }}>
          <div style={{ color: theme.colors.primaryText, fontWeight: 900, marginBottom: '6px' }}>How this ties into Sneedex</div>
          <div style={{ color: theme.colors.mutedText, fontSize: '13px', lineHeight: 1.6 }}>
            Sneedex supports trading canisters and staking-related assets. ICP Neuron Manager canisters are directly tradable, and SNS
            neuron workflows on Sneed are designed to support transferable/tradable positions.
          </div>
        </div>
      </main>
    </div>
  );
}

