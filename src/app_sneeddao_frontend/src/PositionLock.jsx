import React, { useState, useEffect } from 'react';
import { Principal } from "@dfinity/principal";
import { useLocation, Link } from 'react-router-dom';
import { createActor as createBackendActor, canisterId as backendCanisterId } from 'declarations/app_sneeddao_backend';
import { createActor as createIcpSwapActor } from 'external/icp_swap';
import { createActor as createLedgerActor } from 'external/icrc1_ledger';
import { getTokenLogo, get_token_conversion_rates } from './utils/TokenUtils';
import PositionCard from './PositionCard';
import './Wallet.css';
import { lockFromLocks } from './utils/PositionUtils';

function PositionLock() {
    const [positions, setPositions] = useState([]);
    const [showSpinner, setShowSpinner] = useState(true);
    const location = useLocation();

    useEffect(() => {
        const searchParams = new URLSearchParams(location.search);
        const swap_canister_id = searchParams.get('swap');
        var positionIds = searchParams.get('positions') ? searchParams.get('positions').split(',') : null;
        if (positionIds) {
            for (let i = 0; i < positionIds.length; i++) {
                positionIds[i] = BigInt(positionIds[i]);
            }
        }

        if (swap_canister_id && positionIds) {
            fetchPositionDetails(swap_canister_id, positionIds);
        }
    }, [location]);

    const fetchPositionDetails = async (swap_canister_id, positionIds) => {
        try {
            setShowSpinner(true);
            const backendActor = createBackendActor(backendCanisterId);
            const swapActor = createIcpSwapActor(swap_canister_id);

            const swap_meta = await swapActor.metadata();

            const token0 = swap_meta.ok.token0.address;
            const token1 = swap_meta.ok.token1.address;

            var token_meta = await backendActor.get_cached_token_meta(Principal.fromText(swap_canister_id));
            if (token_meta && token_meta[0]) {
                token_meta = token_meta[0];
            } else {
                token_meta = await swapActor.getTokenMeta();
                await backendActor.set_cached_token_meta(Principal.fromText(swap_canister_id), token_meta);
            }

            const token0Decimals = token_meta.token0[2][1].Nat;
            const token0Symbol = token_meta.token0[1][1].Text;
            const token1Decimals = token_meta.token1[2][1].Nat;
            const token1Symbol = token_meta.token1[1][1].Text;

            const icrc1_ledger0 = swap_meta.ok.token0.address;
            const ledgerActor0 = createLedgerActor(icrc1_ledger0);
            const metadata0 = await ledgerActor0.icrc1_metadata();
            const token0Logo = getTokenLogo(metadata0);

            const icrc1_ledger1 = swap_meta.ok.token1.address;
            const ledgerActor1 = createLedgerActor(icrc1_ledger1);
            const metadata1 = await ledgerActor1.icrc1_metadata();
            const token1Logo = getTokenLogo(metadata1);

            const conversion_rates = await get_token_conversion_rates();

            let offset = 0;
            const limit = 10;
            let positions = [];
            let hasMorePositions = true;
            while (hasMorePositions) {
                const allPositionsPage = (await swapActor.getUserPositionWithTokenAmount(offset, limit)).ok.content;

                for (const position of allPositionsPage) {
                    if (positionIds.includes(position.id)) {
                        positions.push(position);
                    }
                }

                offset += limit;
                hasMorePositions = allPositionsPage.length === limit;
            }

            var position_locks = await backendActor.get_swap_position_locks(Principal.fromText(swap_canister_id));

            const positions_detailed = positions.map((position) => {

                const lock = lockFromLocks(position.id, position_locks);

                var position_detailed = {
                    swap_canister_id,
                    token0,
                    token1,
                    token0Symbol: token0Symbol,
                    token1Symbol: token1Symbol,
                    token0Logo: token0Logo,
                    token1Logo: token1Logo,
                    token0Decimals: token0Decimals,
                    token1Decimals: token1Decimals,
                    token0_conversion_rate: conversion_rates[token0Symbol] || 0,
                    token1_conversion_rate: conversion_rates[token1Symbol] || 0,
                    details: {
                        positionId: position.id,
                        token0Amount: position.token0Amount,
                        token1Amount: position.token1Amount,
                        tokensOwed0: position.tokensOwed0,
                        tokensOwed1: position.tokensOwed1,
                        tokensUnused0: 0n,
                        tokensUnused1: 0n,
                        frontendOwnership: null,
                        lockInfo: lock ? lock[2] : null
                    }
                }
                return position_detailed;
            });
            setPositions(positions_detailed);
        } catch (error) {
            console.error('Error fetching position details:', error);
        } finally {
            setShowSpinner(false);
        }
    };

    return (
        <div className='page-container'>
            <header className="site-header">
                <div className="logo">
                    <Link to="/">
                        <img src="sneedlock-logo-cropped.png" alt="Sneedlock" />
                    </Link>
                </div>
                <div className="header-right">
                    <Link to="/help" className="help-link">Help</Link>
                </div>
            </header>
            <div className="wallet-container">
                {positions[0] && positions[0].details && (
                    <PositionCard
                        position={positions[0]}
                        positionDetails={positions[0].details}
                        hideButtons={true}
                        hideUnclaimedFees={true}
                    />
                )}
                {showSpinner && (
                    <div className="card">
                        <div className="spinner"></div>
                    </div>
                )}
            </div>
        </div>
    );
}

export default PositionLock;