import { createActor as createIcrc7Actor } from '../../../external/icrc7_ledger';
import { Principal } from '@dfinity/principal';

/**
 * Extract image URL from NFT metadata
 * Supports various metadata formats and standards
 */
export function getNftImage(metadata) {
    if (!metadata || metadata.length === 0) return null;
    // Collections disagree on where the picture lives: a top-level image/url key, an
    // ICRC-97 metadata map with assets, or a blob. Walk the whole value tree, keys first.
    const imageKeys = ['image', 'icrc7:image', 'url', 'icrc7:url', 'logo', 'icrc7:logo', 'thumbnail', 'asset'];
    const looksLikeUrl = (t) => typeof t === 'string' && (/^(https?:|data:image\/|ipfs:)/i.test(t));
    const blobToDataUrl = (blob) => { try { const bytes = new Uint8Array(blob); let bin = ''; for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]); return `data:image/png;base64,${btoa(bin)}`; } catch { return null; } };
    const visit = (entries, depth) => {
        if (depth > 4) return null;
        for (const [key, value] of entries) {
            const lowerKey = String(key).toLowerCase();
            const keyed = imageKeys.some(k => lowerKey.includes(k));
            if (keyed && value.Text !== undefined && looksLikeUrl(value.Text)) return value.Text.replace(/^ipfs:\/\//, 'https://ipfs.io/ipfs/');
            if (keyed && value.Blob !== undefined) { const u = blobToDataUrl(value.Blob); if (u) return u; }
            if (value.Map !== undefined) { const r = visit(value.Map, depth + 1); if (r) return r; }
            if (value.Array !== undefined) { for (const v of value.Array) { if (v.Map !== undefined) { const r = visit(v.Map, depth + 1); if (r) return r; } if (keyed && v.Text !== undefined && looksLikeUrl(v.Text)) return v.Text; } }
        }
        // second pass: any URL-looking text at all
        for (const [, value] of entries) if (value.Text !== undefined && looksLikeUrl(value.Text) && /\.(png|jpe?g|gif|webp|svg)(\?|$)|^data:image/i.test(value.Text)) return value.Text;
        return null;
    };
    return visit(metadata, 0);
}

/**
 * Extract NFT name from metadata
 */
export function getNftName(metadata, tokenId) {
    if (!metadata || metadata.length === 0) return `NFT #${tokenId}`;
    
    const nameKeys = ['name', 'icrc7:name', 'title', 'icrc7:title'];
    
    for (const [key, value] of metadata) {
        const lowerKey = key.toLowerCase();
        
        if (nameKeys.some(k => lowerKey.includes(k))) {
            if (value.Text) return value.Text;
            if (value.Nat !== undefined) return `NFT #${value.Nat}`;
        }
    }
    
    return `NFT #${tokenId}`;
}

/**
 * Extract description from metadata
 */
export function getNftDescription(metadata) {
    if (!metadata || metadata.length === 0) return null;
    
    const descKeys = ['description', 'icrc7:description', 'desc'];
    
    for (const [key, value] of metadata) {
        const lowerKey = key.toLowerCase();
        
        if (descKeys.some(k => lowerKey.includes(k))) {
            if (value.Text) return value.Text;
        }
    }
    
    return null;
}

/**
 * Format Value type for display
 */
export function formatValue(value) {
    if (!value) return 'null';
    
    if (value.Text !== undefined) return value.Text;
    if (value.Nat !== undefined) return value.Nat.toString();
    if (value.Int !== undefined) return value.Int.toString();
    if (value.Blob !== undefined) return `[Blob: ${value.Blob.length} bytes]`;
    if (value.Array !== undefined) {
        return `[Array: ${value.Array.length} items]`;
    }
    if (value.Map !== undefined) {
        return `[Map: ${value.Map.length} entries]`;
    }
    
    return JSON.stringify(value);
}

/**
 * Format metadata for display
 */
export function formatNftMetadata(metadata) {
    if (!metadata || metadata.length === 0) return [];
    
    return metadata.map(([key, value]) => ({
        key,
        value: formatValue(value),
        rawValue: value
    }));
}

/**
 * Load NFT collection data
 */
export async function loadNftCollection(canisterId, account, identity, agent) {
    try {
        const actor = createIcrc7Actor(canisterId, { agent });
        
        // Fetch collection metadata
        const [name, symbol, logo, totalSupply, description] = await Promise.all([
            actor.icrc7_name(),
            actor.icrc7_symbol(),
            actor.icrc7_logo(),
            actor.icrc7_total_supply(),
            actor.icrc7_description().catch(() => [])
        ]);
        
        // Fetch user's NFTs from this collection, page by page (ICRC-7 pages by the last id seen)
        const maxTake = Number((await actor.icrc7_max_take_value().catch(() => []))?.[0] ?? 100n) || 100;
        const take = BigInt(Math.min(maxTake, 200));
        const tokenIds = [];
        let prev = [];
        for (let page = 0; page < 200; page++) {
            const chunk = await actor.icrc7_tokens_of(account, prev, [take]);
            if (chunk.length === 0) break;
            tokenIds.push(...chunk);
            if (BigInt(chunk.length) < take) break;
            prev = [chunk[chunk.length - 1]];
        }
        
        // Fetch metadata for user's tokens (in batches to avoid limits)
        const batchSize = 50;
        const allMetadata = [];
        
        for (let i = 0; i < tokenIds.length; i += batchSize) {
            const batch = tokenIds.slice(i, i + batchSize);
            const metadataBatch = await actor.icrc7_token_metadata(batch);
            allMetadata.push(...metadataBatch);
        }
        
        // Combine token data
        const nfts = tokenIds.map((tokenId, index) => ({
            tokenId,
            metadata: allMetadata[index] && allMetadata[index].length > 0 ? allMetadata[index][0] : [],
            collectionName: name,
            collectionSymbol: symbol
        }));
        
        return {
            canisterId,
            name,
            symbol,
            logo: logo.length > 0 ? logo[0] : null,
            totalSupply,
            description: description.length > 0 ? description[0] : null,
            nfts,
            userTokenCount: tokenIds.length
        };
    } catch (error) {
        console.error(`Error loading NFT collection ${canisterId}:`, error);
        throw error;
    }
}

/**
 * Transfer NFT
 */
export async function transferNft(canisterId, tokenId, toAccount, fromSubaccount, memo, identity, agent) {
    try {
        const actor = createIcrc7Actor(canisterId, { agent });
        
        const transferArg = {
            from_subaccount: fromSubaccount ? [fromSubaccount] : [],
            to: toAccount,
            token_id: tokenId,
            memo: memo ? [memo] : [],
            created_at_time: [BigInt(Date.now() * 1000000)] // current time in nanoseconds
        };
        
        const result = await actor.icrc7_transfer([transferArg]);
        
        if (result.length === 0) {
            throw new Error('No response from transfer');
        }
        
        const transferResult = result[0];
        
        if (!transferResult || transferResult.length === 0) {
            throw new Error('Transfer not processed');
        }
        
        const response = transferResult[0];
        
        if (response.Ok !== undefined) {
            return { success: true, transactionIndex: response.Ok };
        } else if (response.Err) {
            let errorMsg = 'Transfer failed';
            
            if (response.Err.NonExistingTokenId !== undefined) {
                errorMsg = 'Token does not exist';
            } else if (response.Err.InvalidRecipient !== undefined) {
                errorMsg = 'Invalid recipient';
            } else if (response.Err.Unauthorized !== undefined) {
                errorMsg = 'Unauthorized - you do not own this NFT';
            } else if (response.Err.TooOld !== undefined) {
                errorMsg = 'Transaction too old';
            } else if (response.Err.CreatedInFuture) {
                errorMsg = 'Transaction created in future';
            } else if (response.Err.Duplicate) {
                errorMsg = `Duplicate transaction (${response.Err.Duplicate.duplicate_of})`;
            } else if (response.Err.GenericError) {
                errorMsg = response.Err.GenericError.message;
            } else if (response.Err.GenericBatchError) {
                errorMsg = response.Err.GenericBatchError.message;
            }
            
            throw new Error(errorMsg);
        }
        
        throw new Error('Unknown transfer result');
    } catch (error) {
        console.error('Error transferring NFT:', error);
        throw error;
    }
}

/**
 * Verify if a canister implements ICRC-7
 */
export async function verifyIcrc7Support(canisterId, agent) {
    try {
        const actor = createIcrc7Actor(canisterId, { agent });
        const standards = await actor.icrc10_supported_standards();
        
        return standards.some(s => s.name === 'ICRC-7');
    } catch (error) {
        console.error('Error verifying ICRC-7 support:', error);
        return false;
    }
}

/**
 * Fetch basic collection info (for preview when adding)
 */
export async function fetchCollectionInfo(canisterId, agent) {
    try {
        const actor = createIcrc7Actor(canisterId, { agent });
        
        const [name, symbol, logo, totalSupply, description, isIcrc7] = await Promise.all([
            actor.icrc7_name().catch(() => 'Unknown'),
            actor.icrc7_symbol().catch(() => '???'),
            actor.icrc7_logo().catch(() => []),
            actor.icrc7_total_supply().catch(() => 0n),
            actor.icrc7_description().catch(() => []),
            verifyIcrc7Support(canisterId, agent)
        ]);
        
        return {
            name,
            symbol,
            logo: logo.length > 0 ? logo[0] : null,
            totalSupply,
            description: description.length > 0 ? description[0] : null,
            isIcrc7
        };
    } catch (error) {
        console.error('Error fetching collection info:', error);
        throw error;
    }
}

