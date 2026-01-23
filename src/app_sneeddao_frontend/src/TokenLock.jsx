import React, { useState, useEffect } from 'react';
import { Principal } from "@dfinity/principal";
import { useLocation, Link } from 'react-router-dom';
import { createActor as createBackendActor, canisterId as backendCanisterId } from 'declarations/app_sneeddao_backend';
import { createActor as createSneedLockActor, canisterId as sneedLockCanisterId  } from 'declarations/sneed_lock';
import { createActor as createLedgerActor } from 'external/icrc1_ledger';
import { getTokenLogo, get_token_conversion_rate } from './utils/TokenUtils';
import { getPrincipalDisplayInfoFromContext } from './utils/PrincipalUtils';
import { useNaming } from './NamingContext';
import { useTheme } from './contexts/ThemeContext';
import TokenCard from './TokenCard';
import './Wallet.css';
import Header from './components/Header';

function TokenLock() {
    const { theme } = useTheme();
    const { principalNames, principalNicknames } = useNaming();
    const [token, setToken] = useState(null);
    const [locks, setLocks] = useState({});
    const [lockDetailsLoading, setLockDetailsLoading] = useState({});
    const [principalDisplayInfo, setPrincipalDisplayInfo] = useState(new Map());
    const location = useLocation();

    useEffect(() => {
        const searchParams = new URLSearchParams(location.search);
        const ledgerCanisterId = searchParams.get('ledger');
        const lockIds = searchParams.get('locks') ? searchParams.get('locks').split(',') : null;

        if (ledgerCanisterId) {
            fetchTokenDetails(ledgerCanisterId, lockIds);
        }
    }, [location]);

    // Effect to fetch principal display info
    useEffect(() => {
        const fetchPrincipalInfo = () => {
            if (!locks || Object.keys(locks).length === 0 || !principalNames || !principalNicknames) return;

            const uniquePrincipals = new Set();
            Object.values(locks).forEach(lockArray => {
                lockArray.forEach(lock => {
                    if (lock.owner) {
                        uniquePrincipals.add(lock.owner);
                    }
                });
            });

            const displayInfoMap = new Map();
            Array.from(uniquePrincipals).forEach(principalStr => {
                try {
                    const principal = Principal.fromText(principalStr);
                    const displayInfo = getPrincipalDisplayInfoFromContext(
                        principal, 
                        principalNames, 
                        principalNicknames
                    );
                    displayInfoMap.set(principalStr, displayInfo);
                } catch (error) {
                    console.error('Error processing principal:', principalStr, error);
                }
            });

            setPrincipalDisplayInfo(displayInfoMap);
        };

        fetchPrincipalInfo();
    }, [locks, principalNames, principalNicknames]);

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
                lock_id: lock[2].lock_id,
                amount: lock[2].amount,
                expiry: new Date(Number(BigInt(lock[2].expiry || 0) / BigInt(1000000))),
                owner: lock[0].toString() // Extract the lock owner from lock[0]
            }));

            // Fetch conversion rate using the new price service
            const conversion_rate = await get_token_conversion_rate(ledgerCanisterId, decimals);

            setToken({
                ledger_canister_id: Principal.fromText(ledgerCanisterId),
                symbol,
                decimals,
                logo: logo || "icp_symbol.svg",
                locked: formattedLocks.reduce((sum, lock) => sum + BigInt(lock.amount || 0), BigInt(0)),
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
            <Header customLogo="/sneedlock-logo4.png" />
            <div style={{
                textAlign: 'center',
                padding: '2rem 1rem 1rem 1rem',
                background: theme.colors.background
            }}>
                <h1 style={{
                    fontSize: '2.5rem',
                    fontWeight: '700',
                    color: theme.colors.text,
                    margin: '0 0 0.5rem 0',
                    letterSpacing: '-0.025em'
                }}>
                    Sneed Lock 2.0
                </h1>
                <h2 style={{
                    fontSize: '1.5rem',
                    fontWeight: '500',
                    color: theme.colors.textSecondary,
                    margin: '0',
                    letterSpacing: '-0.01em'
                }}>
                    Token Lock
                </h2>
            </div>
            <main className="wallet-container centered">
                {token && (
                    <TokenCard
                        token={token}
                        locks={locks}
                        lockDetailsLoading={lockDetailsLoading}
                        principalDisplayInfo={principalDisplayInfo}
                        showDebug={false}
                        hideAvailable={true}
                        hideButtons={true}
                        defaultExpanded={true}
                        defaultLocksExpanded={true}
                    />
                )}
            </main>
        </div>
    );
}

export default TokenLock;