import React from 'react';
import { useSearchParams } from 'react-router-dom';
import { useSns } from '../contexts/SnsContext';
import Header from '../components/Header';
import TransactionList from '../components/TransactionList';

function Transactions() {
    const { selectedSnsRoot } = useSns();
    const [searchParams] = useSearchParams();

    return (
        <div className='page-container'>
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