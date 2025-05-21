import React, { useState, useEffect } from 'react';
import { Principal } from '@dfinity/principal';
import { createActor as createSnsRootActor } from 'external/sns_root';
import { createActor as createSnsArchiveActor } from 'external/sns_archive';
import { createActor as createSnsIndexActor } from 'external/sns_index';
import { PrincipalDisplay } from '../utils/PrincipalUtils';

const PAGE_SIZE = 10;

const styles = {
    container: {
        backgroundColor: '#2a2a2a',
        borderRadius: '8px',
        padding: '20px',
        marginTop: '20px'
    },
    header: {
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: '20px'
    },
    filters: {
        display: 'flex',
        gap: '10px',
        marginBottom: '20px'
    },
    filterButton: {
        backgroundColor: '#3a3a3a',
        border: '1px solid #4a4a4a',
        borderRadius: '4px',
        padding: '8px 16px',
        color: '#fff',
        cursor: 'pointer'
    },
    filterButtonActive: {
        backgroundColor: '#3498db',
        border: '1px solid #2980b9'
    },
    table: {
        width: '100%',
        borderCollapse: 'collapse'
    },
    th: {
        textAlign: 'left',
        padding: '12px',
        borderBottom: '1px solid #3a3a3a',
        color: '#888'
    },
    td: {
        padding: '12px',
        borderBottom: '1px solid #3a3a3a',
        color: '#fff'
    },
    pagination: {
        display: 'flex',
        justifyContent: 'center',
        gap: '10px',
        marginTop: '20px'
    },
    pageButton: {
        backgroundColor: '#3a3a3a',
        border: '1px solid #4a4a4a',
        borderRadius: '4px',
        padding: '8px 16px',
        color: '#fff',
        cursor: 'pointer'
    },
    pageButtonDisabled: {
        opacity: 0.5,
        cursor: 'not-allowed'
    },
    loadingSpinner: {
        display: 'flex',
        justifyContent: 'center',
        padding: '20px',
        color: '#888'
    },
    principalCell: {
        display: 'flex',
        flexDirection: 'column',
        gap: '4px'
    },
    subaccount: {
        fontSize: '12px',
        color: '#888',
        wordBreak: 'break-all'
    }
};

const TransactionType = {
    ALL: 'all',
    TRANSFER: 'transfer',
    MINT: 'mint',
    BURN: 'burn',
    APPROVE: 'approve'
};

function TransactionList({ snsRootCanisterId, principalId = null }) {
    const [transactions, setTransactions] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [page, setPage] = useState(0);
    const [totalTransactions, setTotalTransactions] = useState(0);
    const [selectedType, setSelectedType] = useState(TransactionType.ALL);
    const [indexCanisterId, setIndexCanisterId] = useState(null);
    const [archiveCanisterId, setArchiveCanisterId] = useState(null);

    // Fetch canister IDs from SNS root
    const fetchCanisterIds = async () => {
        try {
            const snsRootActor = createSnsRootActor(snsRootCanisterId);
            const response = await snsRootActor.list_sns_canisters({});
            console.log("list_sns_canisters", response);

            // Set the index and archive canister IDs - they are already Principal objects
            setIndexCanisterId(response.index[0]);
            setArchiveCanisterId(response.archives[0]);
        } catch (err) {
            setError('Failed to fetch canister IDs');
            console.error('Error fetching canister IDs:', err);
        }
    };

    // Fetch transactions from index canister
    const fetchFromIndex = async () => {
        try {
            // indexCanisterId is already a Principal, no need to convert
            const indexActor = createSnsIndexActor(indexCanisterId);
            const account = {
                owner: Principal.fromText(principalId),
                subaccount: []
            };
            
            const response = await indexActor.get_account_transactions({
                account,
                max_results: PAGE_SIZE,
                start: page > 0 ? [page * PAGE_SIZE] : []
            });

            if (response.Ok) {
                console.log("Transaction response:", response.Ok.transactions[0]); // Log first transaction for debugging
                const filteredTransactions = filterTransactions(response.Ok.transactions);
                setTransactions(filteredTransactions);
                setTotalTransactions(Number(response.Ok.oldest_tx_id) + 1);
            } else {
                throw new Error(response.Err.message);
            }
        } catch (err) {
            setError('Failed to fetch transactions from index');
            console.error('Error fetching from index:', err);
        }
    };

    // Fetch transactions from archive canister
    const fetchFromArchive = async () => {
        try {
            // archiveCanisterId is already a Principal, no need to convert
            const archiveActor = createSnsArchiveActor(archiveCanisterId);
            const response = await archiveActor.get_transactions({
                start: BigInt(page * PAGE_SIZE),
                length: BigInt(PAGE_SIZE)
            });

            const filteredTransactions = filterTransactions(response.transactions);
            setTransactions(filteredTransactions);
            // You might need to implement a way to get total transactions from archive
        } catch (err) {
            setError('Failed to fetch transactions from archive');
            console.error('Error fetching from archive:', err);
        }
    };

    // Filter transactions based on selected type
    const filterTransactions = (txs) => {
        if (selectedType === TransactionType.ALL) return txs;
        return txs.filter(tx => tx.transaction.kind === selectedType);
    };

    // Fetch transactions based on whether principalId is provided
    const fetchTransactions = async () => {
        setLoading(true);
        setError(null);

        try {
            if (principalId && indexCanisterId) {
                await fetchFromIndex();
            } else if (archiveCanisterId) {
                await fetchFromArchive();
            }
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchCanisterIds();
    }, [snsRootCanisterId]);

    useEffect(() => {
        if (indexCanisterId || archiveCanisterId) {
            fetchTransactions();
        }
    }, [indexCanisterId, archiveCanisterId, page, selectedType, principalId]);

    const formatAmount = (amount, decimals = 8) => {
        const value = Number(amount) / Math.pow(10, decimals);
        return value.toLocaleString(undefined, {
            minimumFractionDigits: 0,
            maximumFractionDigits: 8
        });
    };

    const formatTimestamp = (timestamp) => {
        return new Date(Number(timestamp) / 1_000_000).toLocaleString();
    };

    if (loading) {
        return <div style={styles.loadingSpinner}>Loading transactions...</div>;
    }

    if (error) {
        return <div style={styles.container}>Error: {error}</div>;
    }

    return (
        <div style={styles.container}>
            <div style={styles.header}>
                <h2>Transactions</h2>
                <div style={styles.filters}>
                    {Object.values(TransactionType).map(type => (
                        <button
                            key={type}
                            style={{
                                ...styles.filterButton,
                                ...(selectedType === type ? styles.filterButtonActive : {})
                            }}
                            onClick={() => setSelectedType(type)}
                        >
                            {type.charAt(0).toUpperCase() + type.slice(1)}
                        </button>
                    ))}
                </div>
            </div>

            <table style={styles.table}>
                <thead>
                    <tr>
                        <th style={styles.th}>Type</th>
                        <th style={{...styles.th, width: '30%'}}>From / To</th>
                        <th style={{...styles.th, width: '15%'}}>Amount</th>
                        <th style={{...styles.th, width: '20%'}}>Time</th>
                    </tr>
                </thead>
                <tbody>
                    {transactions.map((tx, index) => {
                        console.log("Processing transaction:", tx);
                        
                        // Extract transaction details safely
                        const txType = tx.transaction.kind;
                        let fromPrincipal = null;
                        let toPrincipal = null;
                        let amount = null;
                        let transfer = null;

                        // Handle different transaction types
                        switch (txType) {
                            case 'transfer':
                                if (tx.transaction.transfer && tx.transaction.transfer.length > 0) {
                                    transfer = tx.transaction.transfer[0];
                                    fromPrincipal = transfer.from?.owner;
                                    toPrincipal = transfer.to?.owner;
                                    amount = transfer.amount;
                                }
                                break;
                            case 'mint':
                                if (tx.transaction.mint && tx.transaction.mint.length > 0) {
                                    const mint = tx.transaction.mint[0];
                                    toPrincipal = mint.to?.owner;
                                    amount = mint.amount;
                                }
                                break;
                            case 'burn':
                                if (tx.transaction.burn && tx.transaction.burn.length > 0) {
                                    const burn = tx.transaction.burn[0];
                                    fromPrincipal = burn.from?.owner;
                                    amount = burn.amount;
                                }
                                break;
                            case 'approve':
                                if (tx.transaction.approve && tx.transaction.approve.length > 0) {
                                    const approve = tx.transaction.approve[0];
                                    fromPrincipal = approve.from?.owner;
                                    toPrincipal = approve.spender?.owner;
                                    amount = approve.amount;
                                }
                                break;
                        }

                        return (
                            <tr key={index}>
                                <td style={styles.td}>{txType}</td>
                                <td style={{...styles.td, ...styles.principalCell}}>
                                    {fromPrincipal && (
                                        <div>
                                            <span style={{color: '#888'}}>From: </span>
                                            <PrincipalDisplay 
                                                principal={fromPrincipal}
                                                showCopyButton={false}
                                            />
                                            {transfer?.from?.subaccount?.length > 0 && (
                                                <div style={styles.subaccount}>
                                                    Subaccount: {transfer.from.subaccount[0]}
                                                </div>
                                            )}
                                        </div>
                                    )}
                                    {toPrincipal && (
                                        <div style={{marginTop: fromPrincipal ? '8px' : '0'}}>
                                            <span style={{color: '#888'}}>To: </span>
                                            <PrincipalDisplay 
                                                principal={toPrincipal}
                                                showCopyButton={false}
                                            />
                                            {transfer?.to?.subaccount?.length > 0 && (
                                                <div style={styles.subaccount}>
                                                    Subaccount: {transfer.to.subaccount[0]}
                                                </div>
                                            )}
                                        </div>
                                    )}
                                    {!fromPrincipal && !toPrincipal && '-'}
                                </td>
                                <td style={styles.td}>
                                    {amount ? formatAmount(amount) : '-'}
                                </td>
                                <td style={styles.td}>
                                    {formatTimestamp(tx.transaction.timestamp)}
                                </td>
                            </tr>
                        );
                    })}
                </tbody>
            </table>

            <div style={styles.pagination}>
                <button
                    style={{
                        ...styles.pageButton,
                        ...(page === 0 ? styles.pageButtonDisabled : {})
                    }}
                    onClick={() => setPage(p => Math.max(0, p - 1))}
                    disabled={page === 0}
                >
                    Previous
                </button>
                <span style={{ color: '#fff', alignSelf: 'center' }}>
                    Page {page + 1}
                </span>
                <button
                    style={{
                        ...styles.pageButton,
                        ...(transactions.length < PAGE_SIZE ? styles.pageButtonDisabled : {})
                    }}
                    onClick={() => setPage(p => p + 1)}
                    disabled={transactions.length < PAGE_SIZE}
                >
                    Next
                </button>
            </div>
        </div>
    );
}

export default TransactionList; 