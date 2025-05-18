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
};

function Disclaimer() {
  return (
    <div style={styles.container}>
      <div style={styles.section}>
        <h1 style={styles.heading}>Disclaimer</h1>
        <p style={styles.paragraph}>
          Welcome to the SNEED DAO platform. Before using our services, please carefully read and understand the following disclaimers and risk factors.
        </p>
      </div>

      <div style={styles.section}>
        <h2 style={styles.subheading}>General Disclaimer</h2>
        <p style={styles.paragraph}>
          The SNEED DAO platform is an experimental decentralized autonomous organization. The information provided on this platform is for general informational purposes only and should not be construed as financial, investment, legal, or other professional advice.
        </p>
      </div>

      <div style={styles.section}>
        <h2 style={styles.subheading}>Risk Factors</h2>
        <ul style={styles.list}>
          <li style={styles.listItem}>
            <strong>Cryptocurrency Risks:</strong> Cryptocurrencies are highly volatile and speculative assets. You should never invest more than you can afford to lose.
          </li>
          <li style={styles.listItem}>
            <strong>Smart Contract Risks:</strong> Despite thorough testing and auditing, smart contracts may contain bugs or vulnerabilities that could result in the loss of funds.
          </li>
          <li style={styles.listItem}>
            <strong>Regulatory Risks:</strong> The regulatory landscape for cryptocurrencies and DAOs is evolving. Changes in regulations may impact the platform's operations and your assets.
          </li>
          <li style={styles.listItem}>
            <strong>Technical Risks:</strong> The platform may experience technical issues, downtime, or security breaches that could affect your ability to access or use the services.
          </li>
        </ul>
      </div>

      <div style={styles.section}>
        <h2 style={styles.subheading}>No Financial Advice</h2>
        <p style={styles.paragraph}>
          Nothing on this platform constitutes financial advice, investment advice, trading advice, or any other type of advice. You should conduct your own research and consult with qualified professionals before making any financial decisions.
        </p>
      </div>

      <div style={styles.section}>
        <h2 style={styles.subheading}>User Responsibility</h2>
        <p style={styles.paragraph}>
          By using the SNEED DAO platform, you acknowledge and agree that:
        </p>
        <ul style={styles.list}>
          <li style={styles.listItem}>You are solely responsible for your actions and decisions on the platform</li>
          <li style={styles.listItem}>You understand and accept all associated risks</li>
          <li style={styles.listItem}>You will comply with all applicable laws and regulations</li>
          <li style={styles.listItem}>You will not use the platform for any illegal or unauthorized purposes</li>
        </ul>
      </div>

      <div style={styles.section}>
        <h2 style={styles.subheading}>Updates to Disclaimer</h2>
        <p style={styles.paragraph}>
          This disclaimer may be updated from time to time without notice. It is your responsibility to review this disclaimer periodically for any changes.
        </p>
      </div>
    </div>
  );
}

export default Disclaimer; 