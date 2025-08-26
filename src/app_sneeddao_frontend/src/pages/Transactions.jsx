import React from 'react';
import { useSearchParams } from 'react-router-dom';
import { useSns } from '../contexts/SnsContext';
import { useTheme } from '../contexts/ThemeContext';
import Header from '../components/Header';
import TransactionList from '../components/TransactionList';

function Transactions() {
    const { theme } = useTheme();
    const { selectedSnsRoot } = useSns();
    const [searchParams] = useSearchParams();

    return (
        <div className='page-container' style={{ background: theme.colors.primaryGradient, minHeight: '100vh' }}>
            <Header showSnsDropdown={true} />
            <main className="wallet-container">
                <TransactionList 
                    snsRootCanisterId={selectedSnsRoot}
                    isCollapsed={false}
                    onToggleCollapse={() => {}}
                />
            </main>
        </div>
    );
}

export default Transactions; 