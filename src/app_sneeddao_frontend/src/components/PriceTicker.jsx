import React, { useEffect, useState } from 'react';
import './PriceTicker.css';
import { Actor } from '@dfinity/agent';
import { idlFactory as sneedLedgerIDL } from '../external/icrc1_ledger/icrc1_ledger.did.js';
import { getSneedLedgerCanister } from '../utils/canister_utils';

const PriceTicker = ({ icpPrice, sneedPrice, conversionRates }) => {
    const [tickerText, setTickerText] = useState('');
    const [totalSupply, setTotalSupply] = useState(null);

    useEffect(() => {
        const fetchTotalSupply = async () => {
            try {
                const sneedLedgerActor = await Actor.createActor(sneedLedgerIDL, {
                    agent: window.ic.agent,
                    canisterId: getSneedLedgerCanister(),
                });
                const supply = await sneedLedgerActor.icrc1_total_supply();
                setTotalSupply(Number(supply) / Math.pow(10, 8)); // Assuming 8 decimals for SNEED
            } catch (error) {
                console.error('Error fetching total supply:', error);
            }
        };
        fetchTotalSupply();
    }, []);

    useEffect(() => {
        if (icpPrice && sneedPrice && totalSupply !== null) {
            const sneedPriceUSD = sneedPrice * icpPrice;
            const sneedMarketCapICP = totalSupply * sneedPrice;
            const sneedMarketCapUSD = sneedMarketCapICP * icpPrice;

            const formatUSD = (value) => `$${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
            const formatICP = (value) => value.toLocaleString('en-US', { minimumFractionDigits: 4, maximumFractionDigits: 4 });

            const text = [
                `ICP/USD: ${formatUSD(icpPrice)}`,
                `SNEED/ICP: ${formatICP(sneedPrice)} ICP`,
                `SNEED/USD: ${formatUSD(sneedPriceUSD)}`,
                `SNEED FDV: ${formatICP(sneedMarketCapICP)} ICP (${formatUSD(sneedMarketCapUSD)})`
            ].join('  •  ');

            setTickerText(text + '  •  ' + text);
        }
    }, [icpPrice, sneedPrice, totalSupply]);

    const renderTickerChars = () => {
        return tickerText.split('').map((char, index) => (
            <span
                key={index}
                className="ticker-char"
                style={{
                    animationDelay: `${index * 0.05}s`,
                }}
            >
                {char}
            </span>
        ));
    };

    return (
        <div className="ticker-container">
            <div className="ticker">
                {renderTickerChars()}
            </div>
        </div>
    );
};

export default PriceTicker; 