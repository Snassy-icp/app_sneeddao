import React, { useState } from 'react';
import { createSwapRunnerActor } from '../lib/swapRunnerActor';
import { StatCard } from './StatCard';

const Products = () => {
    const [swapRunnerStats, setSwapRunnerStats] = useState({
        total_swaps: 0,
        split_swaps: 0,
        kong_swaps: 0,
        icpswap_swaps: 0,
        unique_users: 0,
        unique_traders: 0
    });

    const fetchSwapRunnerStats = async () => {
        try {
            const swapRunnerActor = createSwapRunnerActor(swapRunnerCanisterId, { agentOptions: { identity } });
            const [stats, userCount, traderCount] = await Promise.all([
                swapRunnerActor.get_global_stats(),
                swapRunnerActor.get_unique_user_count(),
                swapRunnerActor.get_unique_trader_count()
            ]);
            setSwapRunnerStats({
                total_swaps: Number(stats.total_swaps),
                split_swaps: Number(stats.split_swaps),
                kong_swaps: Number(stats.kong_swaps),
                icpswap_swaps: Number(stats.icpswap_swaps),
                unique_users: Number(userCount),
                unique_traders: Number(traderCount)
            });
        } catch (error) {
            console.error('Error fetching SwapRunner stats:', error);
        }
    };

    return (
        <div style={styles.statsGrid}>
            <StatCard 
                value={swapRunnerStats.total_swaps.toString()} 
                label="Total Swaps"
                isLoading={swapRunnerStats.total_swaps === 0}
            />
            <StatCard 
                value={swapRunnerStats.split_swaps.toString()} 
                label="Split Swaps"
                isLoading={swapRunnerStats.split_swaps === 0}
            />
            <StatCard 
                value={swapRunnerStats.kong_swaps.toString()} 
                label="Kong Swaps"
                isLoading={swapRunnerStats.kong_swaps === 0}
            />
            <StatCard 
                value={swapRunnerStats.icpswap_swaps.toString()} 
                label="ICPSwap Swaps"
                isLoading={swapRunnerStats.icpswap_swaps === 0}
            />
            <StatCard 
                value={swapRunnerStats.unique_users.toString()} 
                label="Registered Users"
                isLoading={swapRunnerStats.unique_users === 0}
            />
            <StatCard 
                value={swapRunnerStats.unique_traders.toString()} 
                label="Active Traders"
                isLoading={swapRunnerStats.unique_traders === 0}
            />
        </div>
    );
};

export default Products; 