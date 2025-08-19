import React, { useEffect, useState } from 'react';
import { Outlet, useNavigate } from 'react-router-dom';
import Ticker from './Ticker';
import './Layout.css';
import { Actor } from '@dfinity/agent';
import { createActor as createSneedLedgerActor } from '../../../external/icrc1_ledger';
import { get_token_conversion_rates } from '../utils/TokenUtils';
import { Principal } from '@dfinity/principal';
import { useAuth } from '../AuthContext';
import { useTipNotifications } from '../hooks/useTipNotifications';
import { useReplyNotifications } from '../hooks/useReplyNotifications';

const Layout = ({ children }) => {
  const navigate = useNavigate();
  const { isAuthenticated } = useAuth();
  const { newTipCount, markAsViewed } = useTipNotifications();
  const { newReplyCount, markAsViewed: markRepliesAsViewed } = useReplyNotifications();
  const [tickerText, setTickerText] = useState('Loading...');

  const handleTipClick = () => {
    // Mark tips as viewed when user clicks the notification
    markAsViewed();
    navigate('/tips');
  };

  const handleReplyClick = () => {
    // Mark replies as viewed when user clicks the notification
    markRepliesAsViewed();
    navigate('/posts');
  };

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

        const icpPrice = rates.ICP;  // ICP/USD
        const sneedPriceUSD = rates.SNEED;  // SNEED/USD
        const sneedPriceICP = sneedPriceUSD / icpPrice;  // SNEED/ICP = SNEED/USD ÷ ICP/USD

        console.log('Creating SNEED ledger actor...');
        const sneedLedgerActor = await createSneedLedgerActor(Principal.fromText('hvgxa-wqaaa-aaaaq-aacia-cai'));

        console.log('Fetching total supply...');
        const supply = await sneedLedgerActor.icrc1_total_supply();
        console.log('Total supply:', supply.toString());
        const totalSupply = Number(supply) / Math.pow(10, 8); // Assuming 8 decimals for SNEED

        // Calculate values
        const sneedMarketCapICP = totalSupply * sneedPriceICP;
        const sneedMarketCapUSD = totalSupply * sneedPriceUSD;

        const formatUSD = (value) => `$${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
        const formatICP = (value) => value.toLocaleString('en-US', { minimumFractionDigits: 4, maximumFractionDigits: 4 });

        const priceInfo = [
          `ICP/USD: ${formatUSD(icpPrice)}`,
          `SNEED/ICP: ${formatICP(sneedPriceICP)} ICP`,
          `SNEED/USD: ${formatUSD(sneedPriceUSD)}`,
          `SNEED FDV: ${formatICP(sneedMarketCapICP)} ICP (${formatUSD(sneedMarketCapUSD)})`
        ];

        // Add tip notification if user is authenticated and has new tips
        if (isAuthenticated && newTipCount > 0) {
          const tipMessage = newTipCount === 1 
            ? `💰 You have 1 new tip! Click here to view` 
            : `💰 You have ${newTipCount} new tips! Click here to view`;
          priceInfo.unshift(tipMessage); // Add at the beginning for prominence
        }

        // Add reply notification if user is authenticated and has new replies
        if (isAuthenticated && newReplyCount > 0) {
          const replyMessage = newReplyCount === 1 
            ? `💬 You have 1 new reply! Click here to view` 
            : `💬 You have ${newReplyCount} new replies! Click here to view`;
          priceInfo.unshift(replyMessage); // Add at the beginning for prominence
        }

        const text = priceInfo.join('  •  ');
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
  }, [isAuthenticated, newTipCount, newReplyCount]); // Re-run when tip or reply count changes
  
  return (
    <div className="app-layout">
      <Ticker text={tickerText} onTipClick={handleTipClick} onReplyClick={handleReplyClick} />
      <div className="app-content">
        {children}
      </div>
    </div>
  );
};

export default Layout; 