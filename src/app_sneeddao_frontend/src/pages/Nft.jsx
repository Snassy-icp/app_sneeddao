import React, { useState, useEffect } from 'react';
import { useAuth } from '../AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import { HttpAgent } from '@dfinity/agent';
import Header from '../components/Header';
import NftCollectionCard from '../NftCollectionCard';
import SendNftModal from '../SendNftModal';
import AddNftCollectionModal from '../AddNftCollectionModal';
import { loadNftCollection, transferNft, fetchCollectionAdmins, mintNft } from '../utils/NftUtils';
import { app_sneeddao_backend } from 'declarations/app_sneeddao_backend';
import './Nft.css';

const Nft = () => {
    const { isAuthenticated, identity, login } = useAuth();
    const { theme } = useTheme();
    const [collections, setCollections] = useState([]);
    const [isLoading, setIsLoading] = useState(false);
    const [isInitialLoad, setIsInitialLoad] = useState(true);
    const [error, setError] = useState('');
    const [agent, setAgent] = useState(null);
    
    // Modal states
    const [isSendModalOpen, setIsSendModalOpen] = useState(false);
    const [isAddModalOpen, setIsAddModalOpen] = useState(false);
    const [selectedNft, setSelectedNft] = useState(null);
    const [selectedCollection, setSelectedCollection] = useState(null);
    
    // Refreshing state
    const [refreshingCollections, setRefreshingCollections] = useState(new Set());
    
    // Saved collection IDs
    const [savedCollectionIds, setSavedCollectionIds] = useState([]);
    
    // Initialize agent
    useEffect(() => {
        if (identity) {
            const newAgent = new HttpAgent({ identity });
            
            if (process.env.DFX_NETWORK !== "ic") {
                newAgent.fetchRootKey().catch(err => {
                    console.warn("Unable to fetch root key:", err);
                });
            }
            
            setAgent(newAgent);
        }
    }, [identity]);
    
    // Load saved collection IDs from backend
    useEffect(() => {
        const loadSavedCollections = async () => {
            if (!isAuthenticated || !identity) return;
            
            try {
                // Try to get saved NFT collections from backend
                // For now, we'll use localStorage as fallback
                const stored = localStorage.getItem('nft_collections');
                if (stored) {
                    const ids = JSON.parse(stored);
                    setSavedCollectionIds(ids);
                }
            } catch (err) {
                console.error('Error loading saved collections:', err);
            }
        };
        
        loadSavedCollections();
    }, [isAuthenticated, identity]);
    
    // Load NFT collections
    useEffect(() => {
        const loadCollections = async () => {
            if (!isAuthenticated || !identity || !agent || savedCollectionIds.length === 0) {
                setIsInitialLoad(false);
                return;
            }
            
            setIsLoading(true);
            setError('');
            
            try {
                const account = {
                    owner: identity.getPrincipal(),
                    subaccount: []
                };
                
                const loadedCollections = await Promise.allSettled(
                    savedCollectionIds.map(canisterId => 
                        loadNftCollection(canisterId, account, identity, agent)
                    )
                );
                
                const successfulCollections = loadedCollections
                    .filter(result => result.status === 'fulfilled')
                    .map(result => result.value); // every saved collection, owned tokens or not (an admin may own none yet)
                const me = identity.getPrincipal().toText();
                await Promise.all(successfulCollections.map(async (c) => { c.isAdmin = (await fetchCollectionAdmins(c.canisterId, agent)).includes(me); }));
                setCollections(successfulCollections);
                
                // Log any failures
                loadedCollections.forEach((result, index) => {
                    if (result.status === 'rejected') {
                        console.error(`Failed to load collection ${savedCollectionIds[index]}:`, result.reason);
                    }
                });
            } catch (err) {
                console.error('Error loading collections:', err);
                setError('Failed to load NFT collections');
            } finally {
                setIsLoading(false);
                setIsInitialLoad(false);
            }
        };
        
        loadCollections();
    }, [isAuthenticated, identity, agent, savedCollectionIds]);
    
    const handleRefreshCollection = async (collection) => {
        if (!identity || !agent) return;
        
        setRefreshingCollections(prev => new Set(prev).add(collection.canisterId));
        
        try {
            const account = {
                owner: identity.getPrincipal(),
                subaccount: []
            };
            
            const refreshedCollection = await loadNftCollection(
                collection.canisterId,
                account,
                identity,
                agent
            );
            
            setCollections(prev => 
                prev.map(c => 
                    c.canisterId === collection.canisterId ? { ...refreshedCollection, isAdmin: c.isAdmin } : c
                )
            );
        } catch (err) {
            console.error('Error refreshing collection:', err);
            alert('Failed to refresh collection');
        } finally {
            setRefreshingCollections(prev => {
                const next = new Set(prev);
                next.delete(collection.canisterId);
                return next;
            });
        }
    };
    
    const handleAddCollection = async (canisterId, collectionInfo) => {
        // Add to saved collections
        const updatedIds = [...new Set([...savedCollectionIds, canisterId])];
        setSavedCollectionIds(updatedIds);
        localStorage.setItem('nft_collections', JSON.stringify(updatedIds));
        
        // The saved-ids effect reloads the list; appending here as well showed the collection twice.
    };

    const handleMint = async (collection, to, fields) => {
        const id = await mintNft(collection.canisterId, to, fields, agent);
        await handleRefreshCollection(collection);
        return id;
    };
    
    const handleRemoveCollection = (collection) => {
        if (window.confirm(`Remove ${collection.name} from your collections?\n\nNote: This only removes it from your view. Your NFTs are still in your wallet.`)) {
            // Remove from collections
            setCollections(prev => prev.filter(c => c.canisterId !== collection.canisterId));
            
            // Remove from saved IDs
            const updatedIds = savedCollectionIds.filter(id => id !== collection.canisterId);
            setSavedCollectionIds(updatedIds);
            localStorage.setItem('nft_collections', JSON.stringify(updatedIds));
        }
    };
    
    const handleSendNft = (collection, nft) => {
        setSelectedCollection(collection);
        setSelectedNft(nft);
        setIsSendModalOpen(true);
    };
    
    const handleConfirmSend = async (toAccount, memo) => {
        if (!selectedNft || !selectedCollection || !identity || !agent) return;
        
        try {
            const result = await transferNft(
                selectedCollection.canisterId,
                selectedNft.tokenId,
                toAccount,
                null, // from_subaccount (default)
                memo.length > 0 ? memo[0] : null,
                identity,
                agent
            );
            
            alert(`NFT sent successfully!\nTransaction Index: ${result.transactionIndex}`);
            
            // Refresh the collection
            await handleRefreshCollection(selectedCollection);
            
        } catch (err) {
            throw err; // Let the modal handle the error
        }
    };
    
    if (!isAuthenticated) {
        return (
            <>
                <Header />
                <div style={{
                    maxWidth: '800px',
                    margin: '0 auto',
                    padding: '40px 20px',
                    textAlign: 'center'
                }}>
                    <div style={{
                        background: theme.colors.cardBg,
                        border: `1px solid ${theme.colors.border}`,
                        borderRadius: '16px',
                        padding: '60px 40px'
                    }}>
                        <div style={{ fontSize: '64px', marginBottom: '24px' }}>🎨</div>
                        <h2 style={{
                            fontSize: '28px',
                            fontWeight: '600',
                            color: theme.colors.primaryText,
                            marginBottom: '16px'
                        }}>
                            View Your NFT Collection
                        </h2>
                        <p style={{
                            fontSize: '16px',
                            color: theme.colors.secondaryText,
                            marginBottom: '32px',
                            lineHeight: '1.6'
                        }}>
                            Connect your wallet to view and manage your ICRC-7 NFTs
                        </p>
                        <button
                            onClick={login}
                            style={{
                                background: theme.colors.accent,
                                color: theme.colors.primaryBg,
                                border: 'none',
                                borderRadius: '12px',
                                padding: '16px 32px',
                                fontSize: '16px',
                                fontWeight: '600',
                                cursor: 'pointer',
                                transition: 'all 0.2s ease'
                            }}
                            onMouseEnter={(e) => {
                                e.target.style.background = theme.colors.accentHover;
                                e.target.style.transform = 'translateY(-2px)';
                            }}
                            onMouseLeave={(e) => {
                                e.target.style.background = theme.colors.accent;
                                e.target.style.transform = 'translateY(0)';
                            }}
                        >
                            Connect Wallet
                        </button>
                    </div>
                </div>
            </>
        );
    }
    
    return (
        <>
            <Header />
            <div className="nft-page" style={{
                maxWidth: '1400px',
                margin: '0 auto',
                padding: '20px'
            }}>
                {/* Page Header */}
                <div style={{
                    marginBottom: '32px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    flexWrap: 'wrap',
                    gap: '16px'
                }}>
                    <div>
                        <h1 style={{
                            fontSize: '32px',
                            fontWeight: '700',
                            color: theme.colors.primaryText,
                            marginBottom: '8px',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '12px'
                        }}>
                            🎨 My NFTs
                        </h1>
                        <p style={{
                            fontSize: '16px',
                            color: theme.colors.mutedText,
                            margin: 0
                        }}>
                            Your ICRC-7 NFT collections
                        </p>
                    </div>
                    
                    <button
                        onClick={() => setIsAddModalOpen(true)}
                        style={{
                            background: theme.colors.accent,
                            color: theme.colors.primaryBg,
                            border: 'none',
                            borderRadius: '10px',
                            padding: '12px 24px',
                            fontSize: '15px',
                            fontWeight: '600',
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '8px',
                            transition: 'all 0.2s ease'
                        }}
                        onMouseEnter={(e) => {
                            e.target.style.background = theme.colors.accentHover;
                            e.target.style.transform = 'translateY(-2px)';
                        }}
                        onMouseLeave={(e) => {
                            e.target.style.background = theme.colors.accent;
                            e.target.style.transform = 'translateY(0)';
                        }}
                    >
                        <span style={{ fontSize: '18px' }}>+</span>
                        Add Collection
                    </button>
                </div>
                
                {/* Loading State */}
                {isInitialLoad && (
                    <div style={{
                        textAlign: 'center',
                        padding: '60px 20px',
                        color: theme.colors.mutedText
                    }}>
                        <div style={{ fontSize: '48px', marginBottom: '16px' }}>⏳</div>
                        <div style={{ fontSize: '18px' }}>Loading your NFT collections...</div>
                    </div>
                )}
                
                {/* Error State */}
                {error && !isLoading && (
                    <div style={{
                        padding: '16px',
                        borderRadius: '12px',
                        background: `${theme.colors.error}20`,
                        border: `1px solid ${theme.colors.error}40`,
                        color: theme.colors.error,
                        fontSize: '15px',
                        marginBottom: '24px'
                    }}>
                        {error}
                    </div>
                )}
                
                {/* Collections */}
                {!isInitialLoad && collections.length > 0 && (
                    <div>
                        {collections.map(collection => (
                            <NftCollectionCard
                                key={collection.canisterId}
                                collection={collection}
                                onSendNft={handleSendNft}
                                onRemove={handleRemoveCollection}
                                onRefresh={handleRefreshCollection}
                                isRefreshing={refreshingCollections.has(collection.canisterId)}
                                isAdmin={!!collection.isAdmin}
                                onMint={handleMint}
                                myPrincipal={identity?.getPrincipal?.().toText?.() || ''}
                            />
                        ))}
                    </div>
                )}
                
                {/* Empty State */}
                {!isInitialLoad && !isLoading && collections.length === 0 && (
                    <div style={{
                        background: theme.colors.cardBg,
                        border: `1px solid ${theme.colors.border}`,
                        borderRadius: '16px',
                        padding: '80px 40px',
                        textAlign: 'center'
                    }}>
                        <div style={{ fontSize: '64px', marginBottom: '24px' }}>🖼️</div>
                        <h3 style={{
                            fontSize: '24px',
                            fontWeight: '600',
                            color: theme.colors.primaryText,
                            marginBottom: '12px'
                        }}>
                            No NFT Collections Yet
                        </h3>
                        <p style={{
                            fontSize: '16px',
                            color: theme.colors.secondaryText,
                            marginBottom: '32px',
                            lineHeight: '1.6',
                            maxWidth: '500px',
                            margin: '0 auto 32px auto'
                        }}>
                            Add an ICRC-7 NFT collection to view and manage your NFTs
                        </p>
                        <button
                            onClick={() => setIsAddModalOpen(true)}
                            style={{
                                background: theme.colors.accent,
                                color: theme.colors.primaryBg,
                                border: 'none',
                                borderRadius: '10px',
                                padding: '14px 28px',
                                fontSize: '16px',
                                fontWeight: '600',
                                cursor: 'pointer',
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: '8px',
                                transition: 'all 0.2s ease'
                            }}
                            onMouseEnter={(e) => {
                                e.target.style.background = theme.colors.accentHover;
                                e.target.style.transform = 'translateY(-2px)';
                            }}
                            onMouseLeave={(e) => {
                                e.target.style.background = theme.colors.accent;
                                e.target.style.transform = 'translateY(0)';
                            }}
                        >
                            <span style={{ fontSize: '20px' }}>+</span>
                            Add Your First Collection
                        </button>
                    </div>
                )}
            </div>
            
            {/* Modals */}
            <SendNftModal
                isOpen={isSendModalOpen}
                onClose={() => {
                    setIsSendModalOpen(false);
                    setSelectedNft(null);
                    setSelectedCollection(null);
                }}
                nft={selectedNft}
                collection={selectedCollection}
                onConfirm={handleConfirmSend}
            />
            
            <AddNftCollectionModal
                isOpen={isAddModalOpen}
                onClose={() => setIsAddModalOpen(false)}
                onAdd={handleAddCollection}
                agent={agent}
            />
        </>
    );
};

export default Nft;

