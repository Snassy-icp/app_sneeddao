import React, { useState, useEffect } from 'react';
import { Principal } from "@dfinity/principal";
import { useLocation, Link } from 'react-router-dom';
import { createActor as createBackendActor, canisterId as backendCanisterId } from 'declarations/app_sneeddao_backend';
import { createActor as createSneedLockActor, canisterId as sneedLockCanisterId  } from 'external/sneed_lock';
import { createActor as createLedgerActor } from 'external/icrc1_ledger';
import { getTokenLogo, get_token_conversion_rates } from './utils/TokenUtils';
import TokenCard from './TokenCard';
import './Wallet.css';
import Header from './components/Header';

function TokenLock() {
    const [token, setToken] = useState(null);
    const [locks, setLocks] = useState({});
    const [lockDetailsLoading, setLockDetailsLoading] = useState({});
    const location = useLocation();

    useEffect(() => {
        const searchParams = new URLSearchParams(location.search);
        const ledgerCanisterId = searchParams.get('ledger');
        const lockIds = searchParams.get('locks') ? searchParams.get('locks').split(',') : null;

        if (ledgerCanisterId) {
            fetchTokenDetails(ledgerCanisterId, lockIds);
        }
    }, [location]);

    const fetchTokenDetails = async (ledgerCanisterId, lockIds) => {
        try {
            const sneedLockActor = createSneedLockActor(sneedLockCanisterId);
            const ledgerActor = createLedgerActor(ledgerCanisterId);

            const [metadata, symbol, decimals] = await Promise.all([
                ledgerActor.icrc1_metadata(),
                ledgerActor.icrc1_symbol(),
                ledgerActor.icrc1_decimals()
            ]);

            const logo = getTokenLogo(metadata);

            const tokenLocks = await sneedLockActor.get_ledger_token_locks(Principal.fromText(ledgerCanisterId));
            const filteredLocks = lockIds
                ? tokenLocks.filter(lock => lockIds.includes(lock[2].lock_id.toString()))
                : tokenLocks;

            const formattedLocks = filteredLocks.map(lock => ({
                amount: lock[2].amount,
                expiry: new Date(Number(BigInt(lock[2].expiry) / BigInt(1000000)))
            }));

            const conversion_rates = await get_token_conversion_rates();
            const conversion_rate = conversion_rates[symbol] || 0;

            setToken({
                ledger_canister_id: ledgerCanisterId,
                symbol,
                decimals,
                logo: logo || "icp_symbol.svg",
                locked: formattedLocks.reduce((sum, lock) => sum + BigInt(lock.amount), BigInt(0)),
                conversion_rate
            });

            setLocks({ [ledgerCanisterId]: formattedLocks });
            setLockDetailsLoading({ [ledgerCanisterId]: false });
        } catch (error) {
            console.error('Error fetching token details:', error);
        }
    };

    return (
        <div className='page-container'>
            <Header />
            <div className="wallet-container">
                {token && (
                    <TokenCard
                        token={token}
                        locks={locks}
                        lockDetailsLoading={lockDetailsLoading}
                        showDebug={false}
                        hideAvailable={true}
                        hideButtons={true}
                    />
                )}
            </div>
        </div>
    );
}

export default TokenLock;