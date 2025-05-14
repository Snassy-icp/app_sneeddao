import React, { useEffect, useState } from 'react';
import { Outlet } from 'react-router-dom';
import Ticker from './Ticker';
import './Layout.css';
import { Actor } from '@dfinity/agent';
import { idlFactory as sneedLedgerIDL } from '../../../external/icrc1_ledger/icrc1_ledger.did.js';
import { get_token_conversion_rates } from '../utils/TokenUtils';
import { Principal } from '@dfinity/principal';

const Layout = ({ children }) => {
  const [tickerText, setTickerText] = useState('Loading...');
  const [totalSupply, setTotalSupply] = useState(null);
  const [isInitialized, setIsInitialized] = useState(false);

  useEffect(() => {
    // Wait for IC agent to be available
    const checkAgent = () => {
      if (window.ic?.agent) {
        setIsInitialized(true);
      } else {
        setTimeout(checkAgent, 500);
      }
    };
    checkAgent();
  }, []);

  useEffect(() => {
    if (!isInitialized) return;

    const fetchData = async () => {
      try {
        // Get conversion rates
        const rates = await get_token_conversion_rates();
        const icpPrice = rates.icp_usd;
        const sneedPrice = rates.sneed_icp;

        // Get total supply
        const sneedLedgerActor = await Actor.createActor(sneedLedgerIDL, {
          agent: window.ic.agent,
          canisterId: Principal.fromText('hvgxa-wqaaa-aaaaq-aacia-cai'),
        });
        const supply = await sneedLedgerActor.icrc1_total_supply();
        const totalSupply = Number(supply) / Math.pow(10, 8); // Assuming 8 decimals for SNEED

        // Calculate values
        const sneedPriceUSD = sneedPrice * icpPrice;
        const sneedMarketCapICP = totalSupply * sneedPrice;
        const sneedMarketCapUSD = sneedMarketCapICP * icpPrice;

        const formatUSD = (value) => `$${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
        const formatICP = (value) => value.toLocaleString('en-US', { minimumFractionDigits: 4, maximumFractionDigits: 4 });

        const text = [
          `ICP/USD: ${formatUSD(icpPrice)}`,
          `SNEED/ICP: ${formatICP(sneedPrice)} ICP`,
          `SNEED/USD: ${formatUSD(sneedPriceUSD)}`,
          `SNEED Market Cap: ${formatICP(sneedMarketCapICP)} ICP (${formatUSD(sneedMarketCapUSD)})`
        ].join('  •  ');

        setTickerText(text);
      } catch (error) {
        console.error('Error fetching data:', error);
        setTickerText('Error loading data...');
      }
    };

    fetchData();
    // Refresh every minute
    const interval = setInterval(fetchData, 60000);
    return () => clearInterval(interval);
  }, [isInitialized]);
  
  return (
    <div className="app-layout">
      <Ticker text={tickerText} />
      <div className="app-content">
        {children}
      </div>
    </div>
  );
};

export default Layout; 