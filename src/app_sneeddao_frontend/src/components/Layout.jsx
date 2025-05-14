import React, { useEffect, useState } from 'react';
import { Outlet } from 'react-router-dom';
import Ticker from './Ticker';
import './Layout.css';
import { Actor } from '@dfinity/agent';
import { createActor as createSneedLedgerActor } from '../../../external/icrc1_ledger';
import { get_token_conversion_rates } from '../utils/TokenUtils';
import { Principal } from '@dfinity/principal';

const Layout = ({ children }) => {
  const [tickerText, setTickerText] = useState('Loading...');

  useEffect(() => {
    const fetchData = async () => {
      try {
        console.log('Fetching conversion rates...');
        const rates = await get_token_conversion_rates();
        console.log('Rates:', rates);
        
        if (!rates || !rates.ICP || !rates.SNEED) {
          console.error('Invalid rates:', rates);
          setTickerText('Error: Invalid rates data');
          return;
        }

        const icpPrice = rates.ICP;
        const sneedPrice = rates.SNEED;

        console.log('Creating SNEED ledger actor...');
        const sneedLedgerActor = await createSneedLedgerActor(Principal.fromText('hvgxa-wqaaa-aaaaq-aacia-cai'));

        console.log('Fetching total supply...');
        const supply = await sneedLedgerActor.icrc1_total_supply();
        console.log('Total supply:', supply.toString());
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

        console.log('Setting ticker text:', text);
        setTickerText(text);
      } catch (error) {
        console.error('Error fetching data:', error);
        setTickerText('Error loading data. Please try again later.');
      }
    };

    fetchData();
    // Refresh every minute
    const interval = setInterval(fetchData, 60000);
    return () => clearInterval(interval);
  }, []);
  
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