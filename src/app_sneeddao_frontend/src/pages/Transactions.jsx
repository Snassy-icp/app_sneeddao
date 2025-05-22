import React from 'react';
import { useSearchParams } from 'react-router-dom';
import Header from '../components/Header';
import TransactionList from '../components/TransactionList';

const SNEED_SNS_ROOT = 'fp274-iaaaa-aaaaq-aacha-cai';

function Transactions() {
    const [searchParams] = useSearchParams();
    const selectedSnsRoot = searchParams.get('sns') || SNEED_SNS_ROOT;

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