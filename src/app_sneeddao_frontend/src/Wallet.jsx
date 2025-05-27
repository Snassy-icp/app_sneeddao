// Wallet.jsx
import { principalToSubAccount } from "@dfinity/utils";
import { Principal } from "@dfinity/principal";
import React, { useState, useEffect, useRef } from 'react';
import { app_sneeddao_backend, createActor as createBackendActor, canisterId as backendCanisterId } from 'declarations/app_sneeddao_backend';
import { createActor as createLedgerActor } from 'external/icrc1_ledger';
import { createActor as createIcpSwapActor } from 'external/icp_swap';
import { createActor as createRllActor, canisterId as rllCanisterId } from 'external/rll';
import { createActor as createSneedLockActor, canisterId as sneedLockCanisterId  } from 'external/sneed_lock';
import { useNavigate, Link, useLocation } from 'react-router-dom';
import { useAuth } from './AuthContext';
import PrincipalBox from './PrincipalBox';
import './Wallet.css';
import SendTokenModal from './SendTokenModal';
import LockModal from './LockModal';
import LockPositionModal from './LockPositionModal';
import AddSwapCanisterModal from './AddSwapCanisterModal';
import AddLedgerCanisterModal from './AddLedgerCanisterModal';
import SendLiquidityPositionModal from './SendLiquidityPositionModal';
import ConfirmationModal from './ConfirmationModal';
import { get_short_timezone, format_duration, bigDateToReadable, dateToReadable } from './utils/DateUtils';
import { formatAmount, toJsonString } from './utils/StringUtils';
import TokenCard from './TokenCard';
import PositionCard from './PositionCard';
import { get_available, get_available_backend, getTokenLogo, get_token_conversion_rates, getTokenTVL } from './utils/TokenUtils';
import { getPositionTVL } from "./utils/PositionUtils";
import { headerStyles } from './styles/HeaderStyles';
import { createActor as createSnsGovernanceActor, canisterId as snsGovernanceCanisterId } from 'external/sns_governance';
import Header from './components/Header';
import { fetchUserNeurons, fetchUserNeuronsForSns } from './utils/NeuronUtils';

const showDebug = false;
        
const known_icrc1_ledgers = {};
var summed_locks = {};

function Wallet() {
    const { identity, isAuthenticated, logout } = useAuth();
    const navigate = useNavigate();
    const location = useLocation();
    const [tokens, setTokens] = useState([]);
    const [showSendModal, setShowSendModal] = useState(false);
    const [selectedToken, setSelectedToken] = useState(null);
    const [showLockModal, setShowLockModal] = useState(false);
    const [showLockPositionModal, setShowLockPositionModal] = useState(false);
    const [showAddSwapModal, setShowAddSwapModal] = useState(false);
    const [showAddLedgerModal, setShowAddLedgerModal] = useState(false);
    const [showSendLiquidityPositionModal, setShowSendLiquidityPositionModal] = useState(false);
    const [selectedLiquidityPosition, setSelectedLiquidityPosition] = useState(null);
    const [locks, setLocks] = useState([]);
    const [liquidityPositions, setLiquidityPositions] = useState([]);
    const [refreshTrigger, setRefreshTrigger] = useState(0);
    const [showPositionsSpinner, setShowPositionsSpinner] = useState(true);
    const [showTokensSpinner, setShowTokensSpinner] = useState(true);
    const [lockDetailsLoading, setLockDetailsLoading] = useState({});
    const [showConfirmModal, setShowConfirmModal] = useState(false);
    const [confirmAction, setConfirmAction] = useState(null);
    const [confirmMessage, setConfirmMessage] = useState('');
    const [rewardDetailsLoading, setRewardDetailsLoading] = useState({});
    const [totalDollarValue, setTotalDollarValue] = useState(0.0);

    const dex_icpswap = 1;
 
    useEffect(() => {
        if (!isAuthenticated) {
            // Preserve URL parameters when redirecting unauthenticated users
            const currentSearch = location.search;
            navigate(`/${currentSearch}`);
            return;
        }

        // Reset states and cache when component mounts
        setTokens([]);
        setLiquidityPositions([]);
        Object.keys(known_icrc1_ledgers).forEach(key => delete known_icrc1_ledgers[key]);
        
        fetchBalancesAndLocks();
        fetchLiquidityPositions();
    }, [isAuthenticated, navigate, location.search, refreshTrigger]);

    async function fetchTokenDetails(icrc1_ledger, summed_locks) {
        try {

            const ledgerActor = createLedgerActor(icrc1_ledger);
            const metadata = await ledgerActor.icrc1_metadata();
            var logo = getTokenLogo(metadata);
            const symbol = await ledgerActor.icrc1_symbol();
            const decimals = await ledgerActor.icrc1_decimals();
            const fee = await ledgerActor.icrc1_fee();
            const balance = await ledgerActor.icrc1_balance_of({ owner: identity.getPrincipal(), subaccount: [] });
            const tokenConversionRates = await get_token_conversion_rates();
            
            // ICP does not produce a logo in metadata.
            if (symbol.toLowerCase() == "icp" && logo == "") { logo = "icp_symbol.svg"; }

            const subaccount = principalToSubAccount(identity.getPrincipal()); 
            const balance_backend = await ledgerActor.icrc1_balance_of({ owner: Principal.fromText(sneedLockCanisterId), subaccount: [subaccount] });

            var locked = BigInt(0);
            if (summed_locks[icrc1_ledger]) {
                locked = summed_locks[icrc1_ledger];
            }

            var token = {
                ledger_canister_id: icrc1_ledger,
                symbol: symbol,
                decimals: decimals,
                fee: fee,
                logo: logo,
                balance: balance,
                balance_backend: balance_backend,
                locked: locked,
                conversion_rate: tokenConversionRates[symbol] || 0
            };

            token.available = get_available(token);
            token.available_backend = get_available_backend(token);

            return token;
        } catch (e) {
            var token = {
                ledger_canister_id: icrc1_ledger,
                symbol: "ERROR",
                decimals: 8,
                fee: 0,
                logo: "",
                balance: BigInt(0),
                balance_backend: BigInt(0),
                locked: BigInt(0),
                claimable_rewards : BigInt(0),
                available: BigInt(0),
                available_backend: BigInt(0),
                conversion_rate: 0
            };

            return token;
        }
    }

    async function fetchRewardDetails(for_ledger_id) {
        if (for_ledger_id) {
            setRewardDetailsLoading(prevState => ({
                ...prevState,
                [for_ledger_id.toText()]: BigInt(-1)
            }));
        } else {
            setRewardDetailsLoading({});
        }
        // fetch rewards from RLL canister
        const rllActor = createRllActor(rllCanisterId, { agentOptions: { identity } });
        
        // Get neurons using the common utility function with Sneed governance canister
        const sneedGovernanceCanisterId = 'fi3zi-fyaaa-aaaaq-aachq-cai';
        const neurons = await fetchUserNeuronsForSns(identity, sneedGovernanceCanisterId);
        
        // Then get rewards using the new query method
        const arr_balances = await rllActor.balances_of_hotkey_neurons(neurons);

        var new_reward_balances = {};
        var new_icrc1_ledgers = [];

        for (const balance of arr_balances) {
            const ledger_id = balance[0].toText();
            new_reward_balances[ledger_id] = BigInt(balance[1]);
            if (!known_icrc1_ledgers[ledger_id]) {
                known_icrc1_ledgers[ledger_id] = true;
                new_icrc1_ledgers[new_icrc1_ledgers.length] = balance[0];
            }
        };

        if (for_ledger_id) {
            setRewardDetailsLoading(prevState => ({
                ...prevState,
                [for_ledger_id.toText()]: new_reward_balances[for_ledger_id.toText()]
            }));
        } else {
            if (Object.keys(new_reward_balances).length === 0) {
                setRewardDetailsLoading({ "aaaa-aa" : -1 }); // make non-empty to prevent forever spinners
            } else {
                setRewardDetailsLoading(new_reward_balances);
            }
        }

        if (new_icrc1_ledgers.length > 0) {
            const allUpdatedTokens = await Promise.all(new_icrc1_ledgers.map(async (icrc1_ledger) => {
                const updatedToken = await fetchTokenDetails(icrc1_ledger, summed_locks);
                setTokens(prevTokens => [...prevTokens, updatedToken]);
                return updatedToken;
            }));

            fetchLockDetails(allUpdatedTokens);
        }
    }

    // Fetch the token balances and locks from the backend and update the state
    async function fetchBalancesAndLocks(single_refresh_ledger_canister_id) {
        setShowTokensSpinner(true);
        try {
            // retrieve all the summed locks from the backend first.
            const backendActor = createBackendActor(backendCanisterId, { agentOptions: { identity } });
            const sneedLockActor = createSneedLockActor(sneedLockCanisterId, { agentOptions: { identity } });
            if (await sneedLockActor.has_expired_locks()) {
                await sneedLockActor.clear_expired_locks();
            }    
            const summed_locks_list = await sneedLockActor.get_summed_locks();

            summed_locks = {};
            for (const summed_lock of summed_locks_list) {
                const token = summed_lock[0];
                const amount = summed_lock[1];
                summed_locks[token] = amount;
            }

            const registered_icrc1_ledgers = await backendActor.get_ledger_canister_ids();
            var icrc1_ledgers = [];
            for (const ledger of registered_icrc1_ledgers) {
                const ledger_id = ledger.toText();
                if (!known_icrc1_ledgers[ledger_id]) {
                    known_icrc1_ledgers[ledger_id] = true;
                    icrc1_ledgers.push(ledger);
                }
            }
            
            var singleUpdatedToken = [];
            var allUpdatedTokens = [];
            if (single_refresh_ledger_canister_id) {
                const updatedToken = await fetchTokenDetails(single_refresh_ledger_canister_id, summed_locks);
                setTokens(prevTokens => prevTokens.map(token => 
                    token.ledger_canister_id.toText() === single_refresh_ledger_canister_id.toText() ? updatedToken : token
                ));
                singleUpdatedToken = [updatedToken];
            } else {
                allUpdatedTokens = await Promise.all(icrc1_ledgers.map(async (icrc1_ledger) => {
                    const updatedToken = await fetchTokenDetails(icrc1_ledger, summed_locks);
                    setTokens(prevTokens => [...prevTokens, updatedToken]);
                    return updatedToken;
                }));
            }

            fetchLockDetails(single_refresh_ledger_canister_id ? singleUpdatedToken : allUpdatedTokens);
            fetchRewardDetails(single_refresh_ledger_canister_id);

        } catch (error) {
            console.error('Error fetching balances:', error);
        } finally {
            setShowTokensSpinner(false);
        }
    }

    // Fetch the liquidity positions from the backend and update the state
    async function fetchLiquidityPositions() {
        setShowPositionsSpinner(true);
        try {
            const backendActor = createBackendActor(backendCanisterId, { agentOptions: { identity } });
            const sneedLockActor = createSneedLockActor(sneedLockCanisterId, { agentOptions: { identity } });
            const swap_canisters = await backendActor.get_swap_canister_ids();

            if (await sneedLockActor.has_expired_position_locks()) {
                await sneedLockActor.clear_expired_position_locks();
            }
            const claimed_positions = await sneedLockActor.get_claimed_positions_for_principal(identity.getPrincipal());
            const claimed_positions_by_swap = {};
            for (const claimed_position of claimed_positions) {
                if (!claimed_positions_by_swap[claimed_position.swap_canister_id]) {
                    claimed_positions_by_swap[claimed_position.swap_canister_id] = [];
                }
                claimed_positions_by_swap[claimed_position.swap_canister_id].push(claimed_position);
            }

            setLiquidityPositions([]);

            const conversion_rates = await get_token_conversion_rates();

            await Promise.all(swap_canisters.map(async (swap_canister) => {
                    
                try {

                    const claimed_positions_for_swap = claimed_positions_by_swap[swap_canister] || [];
                    const claimed_position_ids_for_swap = claimed_positions_for_swap.map(claimed_position => claimed_position.position_id);
                    const claimed_positions_for_swap_by_id = {};
                    for (const claimed_position of claimed_positions_for_swap) {
                        claimed_positions_for_swap_by_id[claimed_position.position_id] = claimed_position;
                    }

                    // Cache meta
                    const swapActor = createIcpSwapActor(swap_canister);
                    var token_meta = await backendActor.get_cached_token_meta(swap_canister);
                    if (token_meta && token_meta[0]) {

                        token_meta = token_meta[0];

                    } else {

                        token_meta = await swapActor.getTokenMeta();
                        await backendActor.set_cached_token_meta(swap_canister, token_meta);

                    }

                    var swap_meta = await swapActor.metadata();;

                    const icrc1_ledger0 = swap_meta.ok.token0.address;
                    const ledgerActor0 = createLedgerActor(icrc1_ledger0);
                    const metadata0 = await ledgerActor0.icrc1_metadata();
                    var token0Logo = getTokenLogo(metadata0);

                    const icrc1_ledger1 = swap_meta.ok.token1.address;
                    const ledgerActor1 = createLedgerActor(icrc1_ledger1);
                    const metadata1 = await ledgerActor1.icrc1_metadata();
                    var token1Logo = getTokenLogo(metadata1);

                    const token0Decimals = token_meta.token0[2][1].Nat;
                    const token0Symbol = token_meta.token0[1][1].Text;
                    const token1Decimals = token_meta.token1[2][1].Nat;
                    const token1Symbol = token_meta.token1[1][1].Text;

                    // ICP does not produce a logo in metadata.
                    if (token0Symbol.toLowerCase() == "icp" && token0Logo == "") { token0Logo = "icp_symbol.svg"; }
                    if (token1Symbol.toLowerCase() == "icp" && token1Logo == "") { token1Logo = "icp_symbol.svg"; }

                    const userPositionIds = (await swapActor.getUserPositionIdsByPrincipal(identity.getPrincipal())).ok;

                    let offset = 0;
                    const limit = 10;
                    let userPositions = [];
                    let hasMorePositions = true;
                    while (hasMorePositions) {
                        const allPositions = (await swapActor.getUserPositionWithTokenAmount(offset, limit)).ok.content;

                        for (const position of allPositions) {
                            if (userPositionIds.includes(position.id) || claimed_position_ids_for_swap.includes(position.id)) {
                                userPositions.push({
                                    position: position,
                                    claimInfo: claimed_positions_for_swap_by_id[position.id],
                                    frontendOwnership: userPositionIds.includes(position.id)
                                });
                            }
                        }

                        offset += limit;
                        hasMorePositions = allPositions.length === limit;
                    }

                    const positionDetails = await Promise.all(userPositions.map(async (compoundPosition) => {

                        const position = compoundPosition.position;

                        const tokensOwed0 = position.tokensOwed0;
                        const tokensOwed1 = position.tokensOwed1;
                        const token0Amount = position.token0Amount;
                        const token1Amount = position.token1Amount;
                        var tokensUnused0 = 0;
                        var tokensUnused1 = 0;

                        const unused = await swapActor.getUserUnusedBalance(identity.getPrincipal());
                        if (unused.ok) {
                            tokensUnused0 = unused.ok.balance0;
                            tokensUnused1 = unused.ok.balance1;
                        }

                        return {
                            positionId: position.id,
                            tokensOwed0: tokensOwed0,
                            tokensOwed1: tokensOwed1,
                            tokensUnused0: tokensUnused0,
                            tokensUnused1: tokensUnused1,
                            token0Amount: token0Amount,
                            token1Amount: token1Amount,
                            frontendOwnership: compoundPosition.frontendOwnership,
                            lockInfo:
                                (!compoundPosition.frontendOwnership && compoundPosition.claimInfo.position_lock && toJsonString(compoundPosition.claimInfo.position_lock) !== '[]')
                                    ? compoundPosition.claimInfo.position_lock[0]
                                    : null
                        };
                    }));

                    const liquidityPosition = {
                        swapCanisterId: swap_canister,
                        token0: Principal.fromText(icrc1_ledger0),
                        token1: Principal.fromText(icrc1_ledger1),
                        token0Symbol: token0Symbol,
                        token1Symbol: token1Symbol,
                        token0Logo: token0Logo,
                        token1Logo: token1Logo,
                        token0Decimals : token0Decimals,
                        token1Decimals : token1Decimals,
                        token0_conversion_rate: conversion_rates[token0Symbol] || 0,
                        token1_conversion_rate: conversion_rates[token1Symbol] || 0,
                        positions: positionDetails
                    };

                    setLiquidityPositions(prevPositions => [...prevPositions, liquidityPosition]);

                } catch (err) {
                    const liquidityPosition = {
                        swapCanisterId: swap_canister,
                        token0: null,
                        token1: null,
                        token0Symbol: "ERROR",
                        token1Symbol: "ERROR",
                        token0Logo: "",
                        token1Logo: "",
                        token0Decimals : 0,
                        token1Decimals : 0,
                        token0_conversion_rate: 0,
                        token1_conversion_rate: 0,
                        positions: []
                    };

                    console.error('Error fetching liquidity position: ', err);
                    setLiquidityPositions(prevPositions => [...prevPositions, liquidityPosition]);
                }
            }));
        } catch (error) {
            console.error('Error fetching liquidity positions: ', error);
        } finally { 
            setShowPositionsSpinner(false);
        }
    }

    async function fetchLockDetails(currentTokens) {
        // Initialize lockDetailsLoading state
        const initialLoadingState = {};
        currentTokens.forEach(token => {
            initialLoadingState[token.ledger_canister_id] = true;
        });
        setLockDetailsLoading(prevState => ({...prevState, ...initialLoadingState}))

        const sneedLockActor = createSneedLockActor(sneedLockCanisterId, { agentOptions: { identity } });
        if (await sneedLockActor.has_expired_locks()) {
            await sneedLockActor.clear_expired_locks();
        }
        const locks_from_backend = await sneedLockActor.get_token_locks();

        // Fetch lock details for each token in parallel
        await Promise.all(currentTokens.map(async (token) => {
            const ledgerActor = createLedgerActor(token.ledger_canister_id);
            try {

                const tokenLocks = [];
    
                for (const lock of locks_from_backend) {
                    if (lock[1].toText() == token.ledger_canister_id.toText()) {
                        const readableDateFromHugeInt = new Date(Number(lock[3] / (10n ** 6n)));
                        tokenLocks.push({
                            lock_id: lock[0],
                            amount: lock[2],
                            expiry: readableDateFromHugeInt
                        });
                    }
                }
    
                // Update locks state for this token
                setLocks(prevLocks => ({
                    ...prevLocks,
                    [token.ledger_canister_id]: tokenLocks
                }));
    
                // Update loading state for this token
                setLockDetailsLoading(prevState => ({
                    ...prevState,
                    [token.ledger_canister_id]: false
                }));
    
            } catch (err) {

                console.error('Error fetching lock details: ', err);
                //console.error(er);
                setLockDetailsLoading(prevState => ({
                    ...prevState,
                    [token.ledger_canister_id]: false
                }));

            }
        }));
    }

    useEffect(() => {
        var total = 0.0;
        for (const token of tokens) {
            total += getTokenTVL(token, rewardDetailsLoading, false);
        }

        for (const lp of liquidityPositions) {
            for (const positionDetails of lp.positions) {
                total += getPositionTVL(lp, positionDetails, false);
            }
        }

        total = total.toFixed(2);

        setTotalDollarValue(total);
    }, [tokens, liquidityPositions, rewardDetailsLoading]);

    const calc_send_amounts = (token, amount) => {
        var send_from_frontend = BigInt(0);
        var send_from_backend = BigInt(0);
        const avail_backend = get_available_backend(token);
        const avail_tot = BigInt(get_available(token));
        const full_amount = amount + BigInt(token.fee);
        const fuller_amount = full_amount + BigInt(token.fee);
        if (full_amount <= avail_tot) {

            if (full_amount <= avail_backend) {
                send_from_backend = amount;
            } else if (full_amount <= token.balance) {
                send_from_frontend = amount;
            } else if (fuller_amount <= avail_tot) {
                send_from_backend = avail_backend - BigInt(token.fee);
                send_from_frontend = amount - send_from_backend;
            }

        }
        
        return {
            send_from_frontend : send_from_frontend,
            send_from_backend : send_from_backend
        };
    };

    const handleSendToken = async (token, recipient, amount) => {

        const decimals = await token.decimals;
        const bigintAmount = BigInt(amount * (10 ** decimals));
        const send_amounts = calc_send_amounts(token, bigintAmount);

        if (send_amounts.send_from_backend + send_amounts.send_from_frontend <= BigInt(0)) {
            return; // TODO error!
        }

        if (send_amounts.send_from_backend > 0) {

            const sneedLockActor = createSneedLockActor(sneedLockCanisterId, { agentOptions: { identity } });
        
            const recipientPrincipal = Principal.fromText(recipient);
            const result = await sneedLockActor.transfer_tokens(
                recipientPrincipal,
                [],
                token.ledger_canister_id,
                send_amounts.send_from_backend
            );
    
            const resultJson = JSON.stringify(result, (key, value) => {
                if (typeof value === 'bigint') {
                    return value.toString();
                }
                return value;
            });
    
        }

        if (send_amounts.send_from_frontend > 0) {

            const actor = createLedgerActor(token.ledger_canister_id, {
                agentOptions: {
                    identity,
                },
            });
    
            const decimals = await token.decimals;
    
            const recipientPrincipal = Principal.fromText(recipient);
            const result = await actor.icrc1_transfer({
                to: { owner: recipientPrincipal, subaccount: [] },
                fee: [],
                memo: [],
                from_subaccount: [],
                created_at_time: [],
                amount: send_amounts.send_from_frontend
            });
    
            const resultJson = JSON.stringify(result, (key, value) => {
                if (typeof value === 'bigint') {
                    return value.toString();
                }
                return value;
            });
    
        }

        /*await*/ fetchBalancesAndLocks(token.ledger_canister_id);
    };

    const openSendModal = (token) => {
        setSelectedToken(token);
        setShowSendModal(true);
    };

    const handleSendLiquidityPosition = async (liquidityPosition, recipient) => {

        if(liquidityPosition.frontendOwnership) {
            const actor = createIcpSwapActor(liquidityPosition.swapCanisterId, {
                agentOptions: {
                    identity,
                },
            });

            const recipientPrincipal = Principal.fromText(recipient);
            const result = await actor.transferPosition(identity.getPrincipal(), recipientPrincipal, liquidityPosition.id);

            const resultJson = JSON.stringify(result, (key, value) => {
                if (typeof value === 'bigint') {
                    return value.toString();
                }
                return value;
            });

        } else {

            const sneedLockActor = createSneedLockActor(sneedLockCanisterId, { agentOptions: { identity } });
            const result = await sneedLockActor.transfer_position(Principal.fromText(recipient), liquidityPosition.swapCanisterId, liquidityPosition.id);
            const resultJson = toJsonString(result);
            
        }

        /*await*/ fetchLiquidityPositions();
    };

    const openSendLiquidityPositionModal = (liquidityPosition) => {
        setSelectedLiquidityPosition(liquidityPosition);
        setShowSendLiquidityPositionModal(true);
    };

    const handleAddLock = async (token, amount, expiry) => {
        const ledger_canister_id = token.ledger_canister_id;
        const ledgerActor = createLedgerActor(ledger_canister_id, { agentOptions: { identity } });
        const decimals = await ledgerActor.icrc1_decimals();
        const bigIntAmount = BigInt(amount * (10 ** decimals));
        const available_balance_backend = get_available_backend(token);
        const bigIntAmountSendToBackend = bigIntAmount - available_balance_backend;

        if (bigIntAmountSendToBackend > 0) {
            const principal_subaccount = principalToSubAccount(identity.getPrincipal());
            const recipientPrincipal = Principal.fromText(sneedLockCanisterId);
            const resultSend = await ledgerActor.icrc1_transfer({
                to: { owner: recipientPrincipal, subaccount: [principal_subaccount] },
                fee: [],
                memo: [],
                from_subaccount: [],
                created_at_time: [],
                amount: bigIntAmountSendToBackend
            });

        }

        const sneedLockActor = createSneedLockActor(sneedLockCanisterId, {
            agentOptions: {
                identity
            }
        });

        const result = await sneedLockActor.create_lock(
            bigIntAmount,
            ledger_canister_id,
            BigInt(expiry) * (10n ** 6n)
        );

        locks[token] = locks[token] || [];
        locks[token].push({ lock_id: result.Ok, amount: amount, expiry: expiry });
        setLocks(locks);

        /*await*/ fetchBalancesAndLocks(ledger_canister_id);

        return result;
    };

    const openLockModal = async (token) => {
        setSelectedToken(token);
        setShowLockModal(true);
    };

    const handleAddLockPosition = async (position, expiry) => {
        var result = { "Ok": true };

        const swapActor = createIcpSwapActor(position.swapCanisterId, { agentOptions: { identity } });
        const userPositionIds = (await swapActor.getUserPositionIdsByPrincipal(identity.getPrincipal())).ok;
        const frontendOwnership = userPositionIds.includes(position.id);
        if (frontendOwnership) {

            const sneedLockActor = createSneedLockActor(sneedLockCanisterId, { agentOptions: { identity } });

            // Only try to lock if we have been able to claim the position on the backend
            if (await sneedLockActor.claim_position(position.swapCanisterId, position.id)) {
                result = await swapActor.transferPosition(
                    identity.getPrincipal(), 
                    Principal.fromText(sneedLockCanisterId), 
                    position.id);

                if (!result["err"]) {
                    const expiryBig = BigInt(expiry) * (10n ** 6n);
                    result = await sneedLockActor.create_position_lock(
                        position.swapCanisterId,
                        dex_icpswap,
                        position.id,
                        expiryBig,
                        position.token0,
                        position.token1
                    );
                } else {
                    result = { "Err": { "message": "Unable to transfer position to Sneedlock: "
                        + toJsonString(result["err"]) } };
                }
            } else {
                result = { "Err": { "message": "Unable to claim position." } };
            }
        } else {

            const sneedLockActor = createSneedLockActor(sneedLockCanisterId, { agentOptions: { identity } });

            const expiryBig = BigInt(expiry) * (10n ** 6n);

            result = position.isLocked
                ? await sneedLockActor.update_position_lock(
                    position.swapCanisterId,
                    position.id,
                    expiryBig
                )
                : await sneedLockActor.create_position_lock(
                    position.swapCanisterId,
                    dex_icpswap,
                    position.id,
                    expiryBig,
                    position.token0,
                    position.token1
                );
        }

        // we don't need to wait for this, but it is nice to trigger a refresh here.
        if (result["Ok"]) { /*await*/ fetchLiquidityPositions(); }

        return result;
    };

    const openLockPositionModal = async (liquidityPosition) => {

        setSelectedLiquidityPosition(liquidityPosition);
        setShowLockPositionModal(true);

    };

    
    const withdraw_position_rewards = async (liquidityPosition) => {

        if (liquidityPosition.frontendOwnership) {

            const swapActor = createIcpSwapActor(liquidityPosition.swapCanisterId, { agentOptions: { identity } });

            // Call icpswap API to claim fee rewards
            const claim_result = await swapActor.claim({ positionId : Number(liquidityPosition.id) });
            var ok = claim_result["ok"];

            if (ok) {

                var amount0 = ok.amount0;
                var amount1 = ok.amount1;

                var swap_meta = await swapActor.metadata();;
                const icrc1_ledger0 = swap_meta.ok.token0.address;
                const icrc1_ledger1 = swap_meta.ok.token1.address;

                const unused = await swapActor.getUserUnusedBalance(identity.getPrincipal());
                if (unused.ok) {
                    amount0 += unused.ok.balance0;
                    amount1 += unused.ok.balance1;
                }

                const ledgerActor0 = createLedgerActor(icrc1_ledger0);
                const fee0 = await ledgerActor0.icrc1_fee();

                const ledgerActor1 = createLedgerActor(icrc1_ledger1);
                const fee1 = await ledgerActor1.icrc1_fee();

                var withdraw0_ok = null;
                var withdraw1_ok = null;

                // Call icpswap API to withdraw token0 rewards
                if (amount0 > 0 && amount0 > fee0) {
                    const withdraw0_result = await swapActor.withdraw({
                        fee : fee0,
                        token : icrc1_ledger0,
                        amount : amount0
                    })
                    console.log(toJsonString(withdraw0_result));
                    withdraw0_ok = withdraw0_result.ok;

                    // update token card

                }

                // Call icpswap API to withdraw token1 rewards
                if (amount1 > 0 && amount1 > fee1) {
                    console.log(amount1 + " > fee: " + fee1);
                    const withdraw1_result = await swapActor.withdraw({
                        fee : fee1,
                        token : icrc1_ledger1,
                        amount : amount1
                    })
                    console.log(toJsonString(withdraw1_result));
                    withdraw1_ok = withdraw1_result.ok;

                    // update token card

                }

                // update position card

            } else {
                console.error("claim failed: " + toJsonString(claim_result["err"]));
            }    

        } else {
            //console.log("back" + toJsonString(liquidityPosition));

        }
 
        // if the position is on the frontend, just withdraw directly with a call to swap canister

        // if the position is on the backend, withdraw to backend (preferrably to subaccount!) 
        // then (optionally) send the withdrawn funds to the frontend (may not be needed if in subaccount)

    };

    const handleAddLedgerCanister = async (ledgerCanisterId) => {
        const backendActor = createBackendActor(backendCanisterId, { agentOptions: { identity } });
        await backendActor.register_ledger_canister_id(Principal.fromText(ledgerCanisterId));

        /*await*/ fetchBalancesAndLocks();
    };

    const handleAddSwapCanister = async (swapCanisterId) => {
        const backendActor = createBackendActor(backendCanisterId, { agentOptions: { identity } });
        await backendActor.register_swap_canister_id(Principal.fromText(swapCanisterId));

        /*await*/ fetchLiquidityPositions();
    };

    const handleUnregisterToken = async (ledgerCanisterId) => {
        setConfirmAction(() => async () => {
            const backendActor = createBackendActor(backendCanisterId, { agentOptions: { identity } });
            await backendActor.unregister_ledger_canister_id(ledgerCanisterId);
            /*await*/ fetchBalancesAndLocks();
        });
        setConfirmMessage(`You are about to unregister ledger canister ${ledgerCanisterId}?`);
        setShowConfirmModal(true);
    };

    const handleUnregisterSwapCanister = async (swapCanisterId) => {
        setConfirmAction(() => async () => {
            const backendActor = createBackendActor(backendCanisterId, { agentOptions: { identity } });
            await backendActor.unregister_swap_canister_id(swapCanisterId);
            /*await*/ fetchLiquidityPositions();
        });
        setConfirmMessage(`You are about to unregister swap canister ${swapCanisterId}?`);
        setShowConfirmModal(true);
    };

    const handleClaimRewards = async (token) => {
        setConfirmAction(() => async () => {
            const rllActor = createRllActor(rllCanisterId, { agentOptions: { identity } });
            const claim_results = await rllActor.claim_full_balance_of_hotkey(
                token.ledger_canister_id,
                token.fee);
            /*await*/ fetchBalancesAndLocks(token.ledger_canister_id);
        });
        setConfirmMessage(`Do you want to claim your rewards of ${formatAmount(BigInt(rewardDetailsLoading[token.ledger_canister_id]), token.decimals)} ${token.symbol}?`);
        setShowConfirmModal(true);
    };

    return (
        <div className='page-container'>
            <Header showTotalValue={totalDollarValue} />
            <div className="wallet-container">
                <div className="disclaimer">
                    <h3>Disclaimer</h3>
                    <p>This is <b>beta</b> software. Please only use small amounts (that you don't mind losing) and <b>use at your own risk.</b></p>
                    <p>Maximum lock time is 31 days.</p>
                </div>
                <p>Tokens <b className="card add-ledger-card" onClick={() => setShowAddLedgerModal(true)}>&nbsp;&nbsp;+&nbsp;&nbsp;</b></p>
                <div className="card-grid">
                    {tokens.map((token, index) => (
                        <TokenCard
                            key={index}
                            token={token}
                            locks={locks}
                            lockDetailsLoading={lockDetailsLoading}
                            showDebug={showDebug}
                            openSendModal={openSendModal}
                            openLockModal={openLockModal}
                            handleUnregisterToken={handleUnregisterToken}
                            rewardDetailsLoading={rewardDetailsLoading}
                            handleClaimRewards={handleClaimRewards}
                        />
                    ))}
                    {showTokensSpinner ? (
                        <div className="card">
                            <div className="spinner"></div>
                        </div>
                    ) : (
                        <div/>
                    )}
                </div>
                <p>Liquidity Positions <b className="card add-swap-card" onClick={() => setShowAddSwapModal(true)}>&nbsp;&nbsp;+&nbsp;&nbsp;</b></p>
                <div className="card-grid">                
                    {liquidityPositions.map((position, index) => (
                        position.positions.length < 1 
                        ? <div key={index} className="card">

                            <div className="card-header">
                                <img src={position.token0Logo} alt={position.token0Symbol} className="swap-token-logo1" />
                                <img src={position.token1Logo} alt={position.token1Symbol} className="swap-token-logo2" />
                                <span className="token-symbol">{position.token0Symbol}/{position.token1Symbol}</span>
                            </div>
                            <br />
                            <p>No Positions</p>
                            <div className="action-buttons">
                                <div className="tooltip-wrapper">
                                    <button className="remove-button" onClick={() => handleUnregisterSwapCanister(position.swapCanisterId)}>
                                        <img src="red-x-black.png" alt="Remove" />
                                    </button>
                                    <span className="tooltip">Remove Swap Pair</span>
                                </div>
                            </div>
                        </div>

                        : position.positions.map((positionDetails, positionIndex) => (
                            <PositionCard
                                key={`${index}-${positionIndex}`}
                                position={position}
                                positionDetails={positionDetails}
                                openSendLiquidityPositionModal={openSendLiquidityPositionModal}
                                openLockPositionModal={openLockPositionModal}
                                withdraw_position_rewards={withdraw_position_rewards}
                                hideButtons={false}
                                hideUnclaimedFees={false}
                            />
                        ))
                    ))}
                    {showPositionsSpinner ? (
                        <div className="card">
                            <div className="spinner"></div>
                        </div>
                    ) : (
                        <div/>
                    )}
                </div>
                <AddSwapCanisterModal
                    show={showAddSwapModal}
                    onClose={() => setShowAddSwapModal(false)}
                    onSubmit={handleAddSwapCanister}
                />
                <AddLedgerCanisterModal
                    show={showAddLedgerModal}
                    onClose={() => setShowAddLedgerModal(false)}
                    onSubmit={handleAddLedgerCanister}
                />
                <SendTokenModal
                    show={showSendModal}
                    onClose={() => setShowSendModal(false)}
                    onSend={handleSendToken}
                    token={selectedToken}
                />
                <LockModal
                    show={showLockModal}
                    onClose={() => setShowLockModal(false)}
                    token={selectedToken}
                    locks={locks}
                    onAddLock={handleAddLock}
                />
                <SendLiquidityPositionModal
                    show={showSendLiquidityPositionModal}
                    onClose={() => setShowSendLiquidityPositionModal(false)}
                    onSend={handleSendLiquidityPosition}
                    liquidityPosition={selectedLiquidityPosition}
                />
                <LockPositionModal
                    show={showLockPositionModal}
                    onClose={() => setShowLockPositionModal(false)}
                    liquidityPosition={selectedLiquidityPosition}
                    onAddLockPosition={handleAddLockPosition}
                />
                <ConfirmationModal
                    show={showConfirmModal}
                    onClose={() => setShowConfirmModal(false)}
                    onSubmit={confirmAction}
                    message={confirmMessage}
                    doAwait={true}
                />
            </div>
        </div>
    );
}

export default Wallet;