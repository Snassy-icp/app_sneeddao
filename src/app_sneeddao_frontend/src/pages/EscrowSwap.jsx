import React, { useState, useEffect } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { Principal } from '@dfinity/principal';
import Header from '../components/Header';
import { useAuth } from '../AuthContext';
import { createActor as createOcEscrowActor } from 'external/oc_escrow';

const styles = {
    container: {
        maxWidth: '1000px',
        margin: '0 auto',
        padding: '2rem',
        color: '#ffffff',
    },
    heading: {
        fontSize: '2.5rem',
        marginBottom: '2rem',
        color: '#ffffff',
        textAlign: 'center',
    },
    inputSection: {
        backgroundColor: '#2a2a2a',
        borderRadius: '8px',
        padding: '2rem',
        marginBottom: '2rem',
    },
    inputGroup: {
        marginBottom: '1.5rem',
    },
    label: {
        display: 'block',
        marginBottom: '0.5rem',
        color: '#ccc',
        fontSize: '1rem',
        fontWeight: 'bold',
    },
    input: {
        width: '100%',
        padding: '0.75rem',
        fontSize: '1rem',
        backgroundColor: '#3a3a3a',
        border: '1px solid #555',
        borderRadius: '4px',
        color: '#fff',
        boxSizing: 'border-box',
    },
    button: {
        backgroundColor: '#3498db',
        color: '#ffffff',
        border: 'none',
        borderRadius: '4px',
        padding: '0.75rem 1.5rem',
        fontSize: '1rem',
        cursor: 'pointer',
        transition: 'background-color 0.2s',
    },
    buttonDisabled: {
        backgroundColor: '#666',
        cursor: 'not-allowed',
    },
    swapCard: {
        backgroundColor: '#2a2a2a',
        borderRadius: '8px',
        padding: '2rem',
        marginBottom: '2rem',
    },
    swapHeader: {
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: '2rem',
        flexWrap: 'wrap',
        gap: '1rem',
    },
    swapId: {
        fontSize: '1.5rem',
        fontWeight: 'bold',
        color: '#3498db',
    },
    status: {
        padding: '0.5rem 1rem',
        borderRadius: '20px',
        fontSize: '0.9rem',
        fontWeight: 'bold',
        textTransform: 'uppercase',
    },
    statusOpen: {
        backgroundColor: '#2ecc71',
        color: '#ffffff',
    },
    statusAccepted: {
        backgroundColor: '#f39c12',
        color: '#ffffff',
    },
    statusCompleted: {
        backgroundColor: '#27ae60',
        color: '#ffffff',
    },
    statusCancelled: {
        backgroundColor: '#e74c3c',
        color: '#ffffff',
    },
    statusExpired: {
        backgroundColor: '#95a5a6',
        color: '#ffffff',
    },
    tokenSection: {
        display: 'grid',
        gridTemplateColumns: '1fr auto 1fr',
        gap: '2rem',
        alignItems: 'center',
        marginBottom: '2rem',
    },
    tokenCard: {
        backgroundColor: '#3a3a3a',
        borderRadius: '6px',
        padding: '1.5rem',
        textAlign: 'center',
    },
    tokenSymbol: {
        fontSize: '1.2rem',
        fontWeight: 'bold',
        color: '#3498db',
        marginBottom: '0.5rem',
    },
    tokenAmount: {
        fontSize: '1.5rem',
        fontWeight: 'bold',
        color: '#ffffff',
        marginBottom: '0.5rem',
    },
    tokenAddress: {
        fontSize: '0.8rem',
        color: '#888',
        wordBreak: 'break-all',
    },
    arrow: {
        fontSize: '2rem',
        color: '#3498db',
        textAlign: 'center',
    },
    detailsSection: {
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))',
        gap: '1.5rem',
        marginTop: '2rem',
    },
    detailCard: {
        backgroundColor: '#3a3a3a',
        borderRadius: '6px',
        padding: '1rem',
    },
    detailLabel: {
        fontSize: '0.9rem',
        color: '#888',
        marginBottom: '0.5rem',
    },
    detailValue: {
        fontSize: '1rem',
        color: '#ffffff',
        fontWeight: 'bold',
        wordBreak: 'break-all',
    },
    error: {
        backgroundColor: 'rgba(231, 76, 60, 0.1)',
        border: '1px solid #e74c3c',
        color: '#e74c3c',
        padding: '1rem',
        borderRadius: '4px',
        marginBottom: '2rem',
    },
    loading: {
        textAlign: 'center',
        padding: '2rem',
        color: '#888',
        fontSize: '1.1rem',
    },
};

function EscrowSwap() {
    const [searchParams, setSearchParams] = useSearchParams();
    const navigate = useNavigate();
    const { identity } = useAuth();
    
    const [swapId, setSwapId] = useState(searchParams.get('swap_id') || '');
    const [acceptingPrincipal, setAcceptingPrincipal] = useState(searchParams.get('accepting_principal') || '');
    const [swapData, setSwapData] = useState(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);

    // Sync URL params with state
    useEffect(() => {
        const params = new URLSearchParams();
        if (swapId) params.set('swap_id', swapId);
        if (acceptingPrincipal) params.set('accepting_principal', acceptingPrincipal);
        setSearchParams(params);
    }, [swapId, acceptingPrincipal, setSearchParams]);

    // Auto-load swap data when page loads with valid swap_id
    useEffect(() => {
        if (swapId && swapId.match(/^\d+$/)) {
            lookupSwap();
        }
    }, []); // Only run on mount

    const lookupSwap = async () => {
        if (!swapId || !swapId.match(/^\d+$/)) {
            setError('Please enter a valid swap ID (number)');
            return;
        }

        setLoading(true);
        setError(null);
        setSwapData(null);

        try {
            // The canister ID should be provided via environment variable or config
            // For now, we'll use a placeholder - you'll need to provide the actual canister ID
            const ESCROW_CANISTER_ID = process.env.CANISTER_ID_OC_ESCROW || process.env.REACT_APP_OC_ESCROW_CANISTER_ID;
            
            if (!ESCROW_CANISTER_ID) {
                throw new Error('Escrow canister ID not configured. Please set CANISTER_ID_OC_ESCROW environment variable.');
            }

            const escrowActor = createOcEscrowActor(ESCROW_CANISTER_ID, {
                agentOptions: { identity }
            });

            const args = {
                swap_id: parseInt(swapId),
                accepting_principal: acceptingPrincipal && acceptingPrincipal.trim() 
                    ? [Principal.fromText(acceptingPrincipal.trim())] 
                    : []
            };

            console.log('Looking up swap with args:', args);
            
            // Add debugging to catch the exact error location
            let response;
            try {
                response = await escrowActor.lookup_swap(args);
                console.log('Lookup response:', response);
            } catch (decodeError) {
                console.error('Detailed decode error:', decodeError);
                console.error('Error stack:', decodeError.stack);
                throw decodeError;
            }

            if (response.Success) {
                setSwapData(response.Success);
            } else if (response.SwapNotFound) {
                setError('Swap not found. Please check the swap ID.');
            } else if (response.SwapIsPrivate) {
                setError('This swap is private and you do not have permission to view it.');
            } else if (response.PrincipalNotFound) {
                setError('The accepting principal was not found or is not valid for this swap.');
            } else if (response.Error) {
                const [code, message] = response.Error;
                setError(`Error ${code}: ${message || 'Unknown error occurred'}`);
            } else {
                setError('An unknown error occurred while looking up the swap.');
            }
        } catch (err) {
            console.error('Error looking up swap:', err);
            if (err.message.includes('Invalid principal')) {
                setError('Invalid accepting principal format. Please enter a valid principal ID.');
            } else {
                setError(`Failed to lookup swap: ${err.message}`);
            }
        } finally {
            setLoading(false);
        }
    };

    const formatAmount = (amount, decimals) => {
        if (!amount || !decimals) return '0';
        const divisor = Math.pow(10, decimals);
        const formattedAmount = (Number(amount) / divisor).toLocaleString();
        return formattedAmount;
    };

    const formatTimestamp = (timestamp) => {
        if (!timestamp) return 'N/A';
        const date = new Date(Number(timestamp));
        return date.toLocaleString();
    };

    const formatPrincipal = (principal) => {
        if (!principal) return 'N/A';
        const str = principal.toString();
        return str.length > 20 ? `${str.slice(0, 10)}...${str.slice(-10)}` : str;
    };

    const getStatusStyle = (status) => {
        if (status.Open !== undefined) return { ...styles.status, ...styles.statusOpen };
        if (status.Accepted !== undefined) return { ...styles.status, ...styles.statusAccepted };
        if (status.Completed !== undefined) return { ...styles.status, ...styles.statusCompleted };
        if (status.Cancelled !== undefined) return { ...styles.status, ...styles.statusCancelled };
        if (status.Expired !== undefined) return { ...styles.status, ...styles.statusExpired };
        return styles.status;
    };

    const getStatusText = (status) => {
        if (status.Open !== undefined) return 'Open';
        if (status.Accepted !== undefined) return 'Accepted';
        if (status.Completed !== undefined) return 'Completed';
        if (status.Cancelled !== undefined) return 'Cancelled';
        if (status.Expired !== undefined) return 'Expired';
        return 'Unknown';
    };

    return (
        <div className="page-container">
            <Header />
            <main style={styles.container}>
                <h1 style={styles.heading}>Escrow Swap Lookup</h1>
                
                {/* Input Section */}
                <div style={styles.inputSection}>
                    <div style={styles.inputGroup}>
                        <label style={styles.label}>Swap ID *</label>
                        <input
                            type="text"
                            value={swapId}
                            onChange={(e) => setSwapId(e.target.value)}
                            placeholder="Enter swap ID (e.g., 123)"
                            style={styles.input}
                        />
                    </div>
                    
                    <div style={styles.inputGroup}>
                        <label style={styles.label}>Accepting Principal (Optional)</label>
                        <input
                            type="text"
                            value={acceptingPrincipal}
                            onChange={(e) => setAcceptingPrincipal(e.target.value)}
                            placeholder="Enter principal ID (optional)"
                            style={styles.input}
                        />
                    </div>
                    
                    <button
                        onClick={lookupSwap}
                        disabled={loading || !swapId}
                        style={{
                            ...styles.button,
                            ...(loading || !swapId ? styles.buttonDisabled : {})
                        }}
                    >
                        {loading ? 'Looking up...' : 'Lookup Swap'}
                    </button>
                </div>

                {/* Error Display */}
                {error && (
                    <div style={styles.error}>
                        {error}
                    </div>
                )}

                {/* Loading Display */}
                {loading && (
                    <div style={styles.loading}>
                        Looking up swap information...
                    </div>
                )}

                {/* Swap Data Display */}
                {swapData && (
                    <div style={styles.swapCard}>
                        {/* Header */}
                        <div style={styles.swapHeader}>
                            <div style={styles.swapId}>Swap #{swapData.id}</div>
                            <div style={getStatusStyle(swapData.status)}>
                                {getStatusText(swapData.status)}
                            </div>
                        </div>

                        {/* Token Exchange */}
                        <div style={styles.tokenSection}>
                            <div style={styles.tokenCard}>
                                <div style={styles.tokenSymbol}>{swapData.token0.symbol}</div>
                                <div style={styles.tokenAmount}>
                                    {formatAmount(swapData.amount0, swapData.token0.decimals)}
                                </div>
                                <div style={styles.tokenAddress}>
                                    {swapData.token0_deposit_address}
                                </div>
                            </div>
                            
                            <div style={styles.arrow}>⇄</div>
                            
                            <div style={styles.tokenCard}>
                                <div style={styles.tokenSymbol}>{swapData.token1.symbol}</div>
                                <div style={styles.tokenAmount}>
                                    {formatAmount(swapData.amount1, swapData.token1.decimals)}
                                </div>
                                <div style={styles.tokenAddress}>
                                    {swapData.token1_deposit_address}
                                </div>
                            </div>
                        </div>

                        {/* Details */}
                        <div style={styles.detailsSection}>
                            <div style={styles.detailCard}>
                                <div style={styles.detailLabel}>Created By</div>
                                <div style={styles.detailValue}>{formatPrincipal(swapData.created_by)}</div>
                            </div>
                            
                            <div style={styles.detailCard}>
                                <div style={styles.detailLabel}>Offered By</div>
                                <div style={styles.detailValue}>{formatPrincipal(swapData.offered_by)}</div>
                            </div>
                            
                            <div style={styles.detailCard}>
                                <div style={styles.detailLabel}>Created At</div>
                                <div style={styles.detailValue}>{formatTimestamp(swapData.created_at)}</div>
                            </div>
                            
                            <div style={styles.detailCard}>
                                <div style={styles.detailLabel}>Expires At</div>
                                <div style={styles.detailValue}>{formatTimestamp(swapData.expires_at)}</div>
                            </div>
                            
                            <div style={styles.detailCard}>
                                <div style={styles.detailLabel}>Visibility</div>
                                <div style={styles.detailValue}>{swapData.is_public ? 'Public' : 'Private'}</div>
                            </div>
                            
                            {swapData.restricted_to && (
                                <div style={styles.detailCard}>
                                    <div style={styles.detailLabel}>Restricted To</div>
                                    <div style={styles.detailValue}>{formatPrincipal(swapData.restricted_to)}</div>
                                </div>
                            )}
                            
                            {swapData.location.Message && (
                                <div style={styles.detailCard}>
                                    <div style={styles.detailLabel}>Location</div>
                                    <div style={styles.detailValue}>OpenChat Message</div>
                                </div>
                            )}
                            
                            {swapData.location.External !== undefined && (
                                <div style={styles.detailCard}>
                                    <div style={styles.detailLabel}>Location</div>
                                    <div style={styles.detailValue}>External</div>
                                </div>
                            )}
                        </div>

                        {/* Status-specific details */}
                        {swapData.status.Accepted && (
                            <div style={styles.detailsSection}>
                                <div style={styles.detailCard}>
                                    <div style={styles.detailLabel}>Accepted By</div>
                                    <div style={styles.detailValue}>{formatPrincipal(swapData.status.Accepted.accepted_by)}</div>
                                </div>
                                <div style={styles.detailCard}>
                                    <div style={styles.detailLabel}>Accepted At</div>
                                    <div style={styles.detailValue}>{formatTimestamp(swapData.status.Accepted.accepted_at)}</div>
                                </div>
                            </div>
                        )}

                        {swapData.status.Completed && (
                            <div style={styles.detailsSection}>
                                <div style={styles.detailCard}>
                                    <div style={styles.detailLabel}>Completed By</div>
                                    <div style={styles.detailValue}>{formatPrincipal(swapData.status.Completed.accepted_by)}</div>
                                </div>
                                <div style={styles.detailCard}>
                                    <div style={styles.detailLabel}>Completed At</div>
                                    <div style={styles.detailValue}>{formatTimestamp(swapData.status.Completed.accepted_at)}</div>
                                </div>
                            </div>
                        )}

                        {swapData.status.Cancelled && (
                            <div style={styles.detailsSection}>
                                <div style={styles.detailCard}>
                                    <div style={styles.detailLabel}>Cancelled At</div>
                                    <div style={styles.detailValue}>{formatTimestamp(swapData.status.Cancelled.cancelled_at)}</div>
                                </div>
                            </div>
                        )}
                    </div>
                )}
            </main>
        </div>
    );
}

export default EscrowSwap;