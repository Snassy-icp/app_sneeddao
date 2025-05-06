import React from 'react';
import { Link } from 'react-router-dom';
import './Help.css';

function Help() {
  return (
    <div className='page-container'>
      <header className="site-header">
        <div className="logo">
          <Link to="/wallet">
            <img src="sneedlock-logo-cropped.png" alt="Sneedlock" />
          </Link>
        </div>
        <nav className="nav-links">
          <Link to="/help" className="active">Help</Link>
          <Link to="/rll">RLL</Link>
        </nav>
      </header>
      <main className="help-container">
        <h1>Sneedlock Help Guide</h1>
        <p>Welcome to Sneedlock, a decentralized application built on the Internet Computer. Here's what you can do with our dApp:</p>

        <h2>Managing Tokens</h2>
        <ul>
          <li>View your token balances, including available and locked amounts</li>
          <li>Add new tokens by registering ledger canister IDs</li>
          <li>Send tokens to other addresses</li>
          <li>Lock tokens for a specified duration</li>
          <li>View lock details including amount, expiry date, and duration</li>
          <li>Remove tokens from your list (if balance is zero)</li>
        </ul>

        <h2>Managing Liquidity Positions</h2>
        <ul>
          <li>View your liquidity positions for different token pairs</li>
          <li>Add new swap canisters to track more liquidity positions</li>
          <li>See details of each position, including liquidity and unclaimed fees</li>
          <li>Send liquidity positions to other addresses</li>
          <li>Lock liquidity positions for a specified duration</li>
          <li>Remove swap canisters from your list (if no positions exist)</li>
          <li>(Coming Soon) Withdraw unclaimed fees from your positions</li>
        </ul>

        <h2>Additional Features</h2>
        <ul>
          <li>View your principal ID</li>
          <li>Log out of your account</li>
          <li>Refresh your token balances and liquidity positions</li>
        </ul>

        <h2>Important Notes</h2>
        <ul>
        <li>This is beta software. Use small amounts and proceed at your own risk.</li>
        <li>Maximum lock time is 7 days.</li>
        <li>At this time, only liquidity positions from ICPSwap are supported.</li>
        </ul>
      </main>
    </div>
  );
}

export default Help;