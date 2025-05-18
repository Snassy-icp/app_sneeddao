import React from 'react';

const styles = {
  container: {
    maxWidth: '800px',
    margin: '0 auto',
    padding: '2rem',
    color: '#fff',
  },
  section: {
    marginBottom: '2rem',
  },
  heading: {
    fontSize: '2rem',
    marginBottom: '1.5rem',
    color: '#fff',
  },
  subheading: {
    fontSize: '1.5rem',
    marginBottom: '1rem',
    color: '#fff',
  },
  paragraph: {
    marginBottom: '1rem',
    lineHeight: '1.6',
    color: '#ccc',
  },
  list: {
    marginLeft: '2rem',
    marginBottom: '1rem',
  },
  listItem: {
    marginBottom: '0.5rem',
    color: '#ccc',
  },
  warningBox: {
    backgroundColor: '#2a2a2a',
    border: '1px solid #e74c3c',
    borderRadius: '8px',
    padding: '1.5rem',
    marginBottom: '2rem',
  },
  warningHeading: {
    color: '#e74c3c',
    fontSize: '1.5rem',
    marginBottom: '1rem',
  },
  warningText: {
    color: '#e74c3c',
    marginBottom: '1rem',
    lineHeight: '1.6',
  },
};

function Disclaimer() {
  return (
    <div style={styles.container}>
      <div style={styles.warningBox}>
        <h2 style={styles.warningHeading}>⚠️ IMPORTANT NOTICE - NO RESPONSIBILITY DISCLAIMER ⚠️</h2>
        <p style={styles.warningText}>
          BY USING THE SNEED DAO PLATFORM, YOU EXPLICITLY ACKNOWLEDGE AND AGREE THAT YOU ARE USING THE PLATFORM ENTIRELY AT YOUR OWN RISK. WE ACCEPT ABSOLUTELY NO RESPONSIBILITY OR LIABILITY WHATSOEVER FOR ANY CONSEQUENCES RESULTING FROM YOUR USE OF THE PLATFORM.
        </p>
        <p style={styles.warningText}>
          THIS INCLUDES, BUT IS NOT LIMITED TO: FINANCIAL LOSSES, TECHNICAL ISSUES, SECURITY BREACHES, SMART CONTRACT VULNERABILITIES, REGULATORY COMPLIANCE, OR ANY OTHER POTENTIAL RISKS OR DAMAGES.
        </p>
      </div>

      <div style={styles.section}>
        <h1 style={styles.heading}>Complete Disclaimer of Liability</h1>
        <p style={styles.paragraph}>
          The SNEED DAO platform is provided strictly on an "AS IS" and "AS AVAILABLE" basis. We make no warranties, representations, or guarantees of any kind, whether express or implied, regarding the platform's operation, security, reliability, or suitability for any purpose.
        </p>
      </div>

      <div style={styles.section}>
        <h2 style={styles.subheading}>Absolute Non-Responsibility Statement</h2>
        <p style={styles.paragraph}>
          We explicitly disclaim all responsibility and liability for:
        </p>
        <ul style={styles.list}>
          <li style={styles.listItem}>Any financial losses or damages of any kind</li>
          <li style={styles.listItem}>The accuracy, completeness, or reliability of any information provided</li>
          <li style={styles.listItem}>Any technical issues, downtime, or platform malfunctions</li>
          <li style={styles.listItem}>Any security breaches or unauthorized access</li>
          <li style={styles.listItem}>Any smart contract vulnerabilities or bugs</li>
          <li style={styles.listItem}>Any regulatory or legal compliance issues</li>
          <li style={styles.listItem}>Any decisions made based on information from the platform</li>
          <li style={styles.listItem}>Any third-party services or integrations</li>
          <li style={styles.listItem}>Any consequences of platform upgrades or changes</li>
        </ul>
      </div>

      <div style={styles.section}>
        <h2 style={styles.subheading}>High-Risk Activity Warning</h2>
        <p style={styles.paragraph}>
          Cryptocurrency and DAO participation are EXTREMELY HIGH-RISK activities. You acknowledge that:
        </p>
        <ul style={styles.list}>
          <li style={styles.listItem}>You could lose ALL of your invested funds</li>
          <li style={styles.listItem}>Cryptocurrency values are highly volatile and unpredictable</li>
          <li style={styles.listItem}>Smart contracts may contain unknown vulnerabilities</li>
          <li style={styles.listItem}>Regulatory changes could impact platform operations</li>
          <li style={styles.listItem}>Technical failures could result in permanent loss of access</li>
        </ul>
      </div>

      <div style={styles.section}>
        <h2 style={styles.subheading}>User Responsibility</h2>
        <p style={styles.paragraph}>
          You are SOLELY and ENTIRELY responsible for:
        </p>
        <ul style={styles.list}>
          <li style={styles.listItem}>Conducting your own research and due diligence</li>
          <li style={styles.listItem}>Understanding all risks involved</li>
          <li style={styles.listItem}>Securing your own wallet and credentials</li>
          <li style={styles.listItem}>Complying with all applicable laws and regulations</li>
          <li style={styles.listItem}>Verifying all information independently</li>
          <li style={styles.listItem}>Managing your own investment decisions</li>
          <li style={styles.listItem}>Any tax obligations or reporting requirements</li>
        </ul>
      </div>

      <div style={styles.section}>
        <h2 style={styles.subheading}>No Financial Advice</h2>
        <p style={styles.paragraph}>
          Nothing on this platform constitutes financial, investment, legal, or tax advice. Any numbers, metrics, or statistics shown are for informational purposes only and should not be relied upon for any decision-making.
        </p>
      </div>

      <div style={styles.section}>
        <h2 style={styles.subheading}>Indemnification</h2>
        <p style={styles.paragraph}>
          By using the platform, you agree to indemnify, defend, and hold harmless SNEED DAO, its developers, contributors, and affiliates from and against ANY and ALL claims, damages, losses, costs, investigations, liabilities, judgments, settlements, and expenses.
        </p>
      </div>

      <div style={styles.warningBox}>
        <h2 style={styles.warningHeading}>Final Warning</h2>
        <p style={styles.warningText}>
          IF YOU DO NOT AGREE WITH ANY PART OF THIS DISCLAIMER OR DO NOT ACCEPT THE RISKS INVOLVED, DO NOT USE THE PLATFORM. CONTINUED USE OF THE PLATFORM CONSTITUTES YOUR EXPLICIT ACCEPTANCE OF ALL RISKS AND YOUR ACKNOWLEDGMENT THAT YOU ARE ACTING ENTIRELY AT YOUR OWN RISK.
        </p>
      </div>
    </div>
  );
}

export default Disclaimer; 