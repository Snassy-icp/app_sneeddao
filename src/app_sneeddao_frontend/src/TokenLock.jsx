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
import { FaCoins, FaShieldAlt, FaSpinner } from 'react-icons/fa';

// Custom CSS for animations
const customStyles = `
@keyframes fadeInUp {
    from {
        opacity: 0;
        transform: translateY(20px);
    }
    to {
        opacity: 1;
        transform: translateY(0);
    }
}

@keyframes float {
    0%, 100% { transform: translateY(0px); }
    50% { transform: translateY(-8px); }
}

@keyframes spin {
    from { transform: rotate(0deg); }
    to { transform: rotate(360deg); }
}

.tokenlock-float {
    animation: float 3s ease-in-out infinite;
}

.tokenlock-fade-in {
    animation: fadeInUp 0.5s ease-out forwards;
}

.tokenlock-spin {
    animation: spin 1s linear infinite;
}
`;

// Page accent colors - indigo/blue theme
const lockPrimary = '#6366f1';
const lockSecondary = '#818cf8';

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
        <div className='page-container' style={{ background: theme.colors.primaryGradient, minHeight: '100vh' }}>
            <style>{customStyles}</style>
            <Header customLogo="/sneedlock-logo4.png" />
            
            {/* Hero Banner */}
            <div style={{
                background: `linear-gradient(135deg, ${theme.colors.primaryBg} 0%, ${lockPrimary}12 50%, ${lockSecondary}08 100%)`,
                borderBottom: `1px solid ${theme.colors.border}`,
                padding: '2rem 1rem',
                position: 'relative',
                overflow: 'hidden',
                width: '100%',
                boxSizing: 'border-box'
            }}>
                {/* Background decorations */}
                <div style={{
                    position: 'absolute',
                    top: '-50%',
                    right: '-5%',
                    width: '300px',
                    height: '300px',
                    background: `radial-gradient(circle, ${lockPrimary}15 0%, transparent 70%)`,
                    pointerEvents: 'none'
                }} />
                <div style={{
                    position: 'absolute',
                    bottom: '-40%',
                    left: '10%',
                    width: '200px',
                    height: '200px',
                    background: `radial-gradient(circle, ${lockSecondary}10 0%, transparent 70%)`,
                    pointerEvents: 'none'
                }} />
                
                <div className="tokenlock-fade-in" style={{ maxWidth: '800px', margin: '0 auto', textAlign: 'center', position: 'relative', zIndex: 1 }}>
                    <div style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '8px',
                        background: `${lockPrimary}20`,
                        color: lockPrimary,
                        padding: '6px 14px',
                        borderRadius: '20px',
                        fontSize: '0.8rem',
                        fontWeight: '600',
                        marginBottom: '1rem'
                    }}>
                        <FaShieldAlt size={12} /> SneedLock
                    </div>
                    
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '12px', marginBottom: '0.5rem' }}>
                        <div className="tokenlock-float" style={{
                            width: '48px',
                            height: '48px',
                            borderRadius: '14px',
                            background: `linear-gradient(135deg, ${lockPrimary}, ${lockSecondary})`,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            boxShadow: `0 8px 24px ${lockPrimary}40`,
                        }}>
                            <FaCoins size={22} style={{ color: '#fff' }} />
                        </div>
                        <h1 style={{
                            fontSize: '1.75rem',
                            fontWeight: '700',
                            color: theme.colors.primaryText,
                            margin: 0,
                            letterSpacing: '-0.5px'
                        }}>
                            Token Lock
                        </h1>
                    </div>
                    <p style={{
                        color: theme.colors.secondaryText,
                        fontSize: '0.95rem',
                        margin: 0
                    }}>
                        {token ? `Viewing ${token.symbol} lock details` : 'Loading lock details...'}
                    </p>
                </div>
            </div>
            
            <main style={{ maxWidth: '800px', margin: '0 auto', padding: '1.5rem 1rem' }}>
                {token ? (
                    <div className="tokenlock-fade-in">
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
                    </div>
                ) : (
                    <div className="tokenlock-fade-in" style={{
                        textAlign: 'center',
                        padding: '3rem',
                        background: theme.colors.cardGradient,
                        borderRadius: '20px',
                        border: `1px solid ${theme.colors.border}`,
                        boxShadow: theme.colors.cardShadow,
                    }}>
                        <FaSpinner className="tokenlock-spin" size={32} style={{ color: lockPrimary, marginBottom: '1rem' }} />
                        <p style={{ color: theme.colors.secondaryText, margin: 0 }}>Loading token lock details...</p>
                    </div>
                )}
                
                {/* Back Link */}
                <div style={{ textAlign: 'center', marginTop: '1.5rem' }}>
                    <Link 
                        to="/sneedlock_info" 
                        style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '8px',
                            color: lockPrimary,
                            textDecoration: 'none',
                            fontSize: '0.9rem',
                            fontWeight: '500',
                        }}
                    >
                        <FaShieldAlt size={14} /> View All Locks
                    </Link>
                </div>
            </main>
        </div>
    );
}

export default TokenLock;