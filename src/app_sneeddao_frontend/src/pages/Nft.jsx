import React, { useState, useEffect, useRef } from 'react';
import { useAuth } from '../AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import { HttpAgent } from '@dfinity/agent';
import Header from '../components/Header';
import NftCollectionCard from '../NftCollectionCard';
import SendNftModal from '../SendNftModal';
import AddNftCollectionModal from '../AddNftCollectionModal';
import { getSavedNftCollections, NFT_COLLECTIONS_STORAGE_KEY, loadNftCollection, transferNft, fetchCollectionAdmins, mintNft, approveToken, revokeTokenApproval, approveCollection, revokeCollectionApproval } from '../utils/NftUtils';
import { app_sneeddao_backend } from 'declarations/app_sneeddao_backend';
import './Nft.css';

const spinnerStyle = (theme) => ({ display: 'inline-block', width: '12px', height: '12px', borderRadius: '50%', border: `2px solid ${theme.colors.border}`, borderTopColor: theme.colors.primaryText, animation: 'nft-spin 0.8s linear infinite', verticalAlign: '-2px', marginRight: '6px' });

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
    const [savedCollectionIds, setSavedCollectionIds] = useState(() => getSavedNftCollections());
    // What each saved collection is doing while it loads: id -> { stage, name, symbol, logo, found, error }
    const [loadProgress, setLoadProgress] = useState({});
    const inFlight = useRef(new Set()); // collection ids being loaded right now
    const mounted = useRef(true);
    useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
    
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
    
    // Load the saved collections, each on its own: a card appears as soon as its collection has loaded,
    // and until then its placeholder shows what the loader is doing.
    useEffect(() => {
        if (!isAuthenticated || !identity || !agent) return;
        if (savedCollectionIds.length === 0) { setIsInitialLoad(false); setIsLoading(false); return; }
        const me = identity.getPrincipal().toText();
        const account = { owner: identity.getPrincipal(), subaccount: [] };
        const pending = savedCollectionIds.filter((id) => !collections.some((c) => c.canisterId === id) && !inFlight.current.has(id));
        if (pending.length === 0) { setIsInitialLoad(false); if (inFlight.current.size === 0) setIsLoading(false); return; }
        for (const id of pending) inFlight.current.add(id);
        const alive = mounted; // only unmounting cancels; adding a collection while others load must not
        setIsLoading(true);
        setIsInitialLoad(false);
        setError('');
        setLoadProgress((p) => { const n = { ...p }; for (const id of pending) n[id] = { stage: 'Connecting…' }; return n; });
        Promise.allSettled(pending.map(async (canisterId) => {
            try {
                const c = await loadNftCollection(canisterId, account, identity, agent, (prog) => {
                    if (alive.current) setLoadProgress((p) => ({ ...p, [canisterId]: { ...prog } }));
                });
                c.isAdmin = (await fetchCollectionAdmins(c.canisterId, agent)).includes(me);
                if (!alive.current) return;
                // every saved collection is listed, owned tokens or not (an admin may own none yet); keep the saved order
                setCollections((prev) => {
                    const next = prev.filter((x) => x.canisterId !== canisterId).concat([c]);
                    return next.sort((a, b) => savedCollectionIds.indexOf(a.canisterId) - savedCollectionIds.indexOf(b.canisterId));
                });
                setLoadProgress((p) => { const n = { ...p }; delete n[canisterId]; return n; });
            } catch (err) {
                console.error(`Failed to load collection ${canisterId}:`, err);
                if (alive.current) setLoadProgress((p) => ({ ...p, [canisterId]: { ...(p[canisterId] || {}), stage: null, error: err?.message || String(err) } }));
            } finally {
                inFlight.current.delete(canisterId);
            }
        })).then(() => { if (alive.current && inFlight.current.size === 0) setIsLoading(false); });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isAuthenticated, identity, agent, savedCollectionIds]);
    
    const retryCollection = (canisterId) => {
        // dropping the stale entry makes the loader effect pick it up again
        setLoadProgress((p) => { const n = { ...p }; delete n[canisterId]; return n; });
        setCollections((prev) => prev.filter((c) => c.canisterId !== canisterId));
        setSavedCollectionIds((ids) => [...ids]);
    };
    
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
        localStorage.setItem(NFT_COLLECTIONS_STORAGE_KEY, JSON.stringify(updatedIds));
        
        // The saved-ids effect reloads the list; appending here as well showed the collection twice.
    };

    const handleApproveToken = async (collection, nft, spender, expiresAtMs) => { await approveToken(collection.canisterId, nft.tokenId, spender, expiresAtMs, agent); await handleRefreshCollection(collection); };
    const handleRevokeToken = async (collection, nft, spender) => { try { await revokeTokenApproval(collection.canisterId, nft.tokenId, spender, agent); } catch (e) { alert(`Revoke failed: ${e?.message || e}`); } await handleRefreshCollection(collection); };
    const handleApproveCollection = async (collection, spender, expiresAtMs) => { await approveCollection(collection.canisterId, spender, expiresAtMs, agent); await handleRefreshCollection(collection); };
    const handleRevokeCollection = async (collection, spender) => { try { await revokeCollectionApproval(collection.canisterId, spender, agent); } catch (e) { alert(`Revoke failed: ${e?.message || e}`); } await handleRefreshCollection(collection); };
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
            localStorage.setItem(NFT_COLLECTIONS_STORAGE_KEY, JSON.stringify(updatedIds));
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
                
                {/* Before the agent exists there is nothing to show yet */}
                {isInitialLoad && savedCollectionIds.length > 0 && (
                    <div style={{ textAlign: 'center', padding: '40px 20px', color: theme.colors.mutedText, fontSize: '15px' }}>
                        <span className="nft-spinner" style={spinnerStyle(theme)} /> Connecting your wallet…
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
                
                {/* Collections: loaded cards in saved order, placeholders for the ones still loading */}
                {!isInitialLoad && savedCollectionIds.length > 0 && (
                    <div>
                        {isLoading && (
                            <div style={{ fontSize: '13px', color: theme.colors.mutedText, marginBottom: '12px' }}>
                                Loaded {collections.length} of {savedCollectionIds.length} collections…
                            </div>
                        )}
                        {savedCollectionIds.map((id) => {
                            const collection = collections.find((c) => c.canisterId === id);
                            if (collection) return null;
                            const p = loadProgress[id] || { stage: 'Waiting…' };
                            return (
                                <div key={`pending-${id}`} style={{ background: theme.colors.cardBg, border: `1px solid ${theme.colors.border}`, borderRadius: '12px', marginBottom: '20px', padding: '16px 20px', display: 'flex', alignItems: 'center', gap: '16px' }}>
                                    <div style={{ width: '48px', height: '48px', borderRadius: '8px', background: theme.colors.primaryBg, display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', flexShrink: 0 }}>
                                        {p.logo ? <img src={p.logo} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <span style={{ fontSize: '22px' }}>🖼️</span>}
                                    </div>
                                    <div style={{ minWidth: 0, flex: 1 }}>
                                        <div style={{ fontSize: '18px', fontWeight: '600', color: theme.colors.primaryText, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                            {p.name || <span style={{ fontFamily: 'monospace', fontSize: '14px', color: theme.colors.secondaryText }}>{id}</span>}
                                        </div>
                                        <div style={{ fontSize: '14px', color: p.error ? theme.colors.error : theme.colors.mutedText, display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                                            {p.symbol && <><span>{p.symbol}</span><span>•</span></>}
                                            {p.error ? <span>Could not load: {p.error}</span> : <><span className="nft-spinner" style={spinnerStyle(theme)} /><span>{p.stage}</span></>}
                                        </div>
                                    </div>
                                    {p.error && (
                                        <div style={{ display: 'flex', gap: '8px', flexShrink: 0 }}>
                                            <button onClick={() => retryCollection(id)} style={{ background: 'none', border: `1px solid ${theme.colors.border}`, borderRadius: '8px', color: theme.colors.primaryText, padding: '6px 10px', cursor: 'pointer', fontSize: '13px' }}>Retry</button>
                                            <button onClick={() => handleRemoveCollection({ canisterId: id, name: id })} style={{ background: 'none', border: `1px solid ${theme.colors.border}`, borderRadius: '8px', color: theme.colors.mutedText, padding: '6px 10px', cursor: 'pointer', fontSize: '13px' }}>Remove</button>
                                        </div>
                                    )}
                                </div>
                            );
                        })}
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
                                onApproveToken={handleApproveToken}
                                onRevokeToken={handleRevokeToken}
                                onApproveCollection={handleApproveCollection}
                                onRevokeCollection={handleRevokeCollection}
                            />
                        ))}
                    </div>
                )}
                
                {/* Empty State */}
                {!isInitialLoad && !isLoading && savedCollectionIds.length === 0 && (
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

