# ICRC7 NFT Support Implementation Plan

## Overview
Add comprehensive ICRC7 NFT support with a new `/nft` page, following design patterns from the existing `/wallet` page.

## Key ICRC7 Concepts (from spec)
- **NFTs**: Non-fungible tokens with unique token IDs (natural numbers)
- **Collections**: Each ICRC7 canister hosts one NFT collection
- **Accounts**: Same ICRC-1 account model (principal + subaccount)
- **Batch Operations**: All operations support batch processing
- **Metadata**: Both collection-level and token-level metadata

## Implementation Plan

### 1. Create ICRC7 Actor/Interface
**Files to create:**
- `/src/external/icrc7_ledger/icrc7_ledger.did` - Candid interface definition
- `/src/external/icrc7_ledger/icrc7_ledger.did.js` - Generated JS interface
- `/src/external/icrc7_ledger/index.js` - Actor factory

**Key ICRC7 Methods to Support:**
- `icrc7_collection_metadata()` - Get collection info (name, symbol, logo, etc.)
- `icrc7_symbol()` - Collection symbol
- `icrc7_name()` - Collection name
- `icrc7_logo()` - Collection logo URL
- `icrc7_total_supply()` - Total NFTs in collection
- `icrc7_tokens_of(account, prev, take)` - Get NFTs owned by account (paginated)
- `icrc7_token_metadata(token_ids)` - Get metadata for specific tokens
- `icrc7_owner_of(token_ids)` - Get owner of specific tokens
- `icrc7_transfer(vec TransferArg)` - Transfer NFTs
- `icrc10_supported_standards()` - Check supported standards

### 2. Create NFT Utility Functions
**File: `/src/app_sneeddao_frontend/src/utils/NftUtils.js`**

Functions needed:
- `fetchNftCollections(principal, identity)` - Get all NFT collections for a user
- `fetchNftMetadata(collectionCanisterId, tokenIds, identity)` - Get token metadata
- `loadNftCollection(canisterId, account, identity)` - Load full collection data
- `getNftImage(metadata)` - Extract image URL from metadata
- `getNftName(metadata)` - Extract name from metadata
- `formatNftMetadata(metadata)` - Format metadata for display

### 3. Create NFT Components

#### 3.1 NftCard Component
**File: `/src/app_sneeddao_frontend/src/NftCard.jsx`**
**File: `/src/app_sneeddao_frontend/src/NftCard.css`**

Similar to TokenCard but for individual NFTs:
- Display NFT image (with fallback)
- Display NFT name and token ID
- Display collection name
- Collapsible to show metadata
- Actions: Send, View on explorer

#### 3.2 NftCollectionCard Component
**File: `/src/app_sneeddao_frontend/src/NftCollectionCard.jsx`**

Container for NFTs from same collection:
- Collection header with logo, name, symbol
- Grid of NFTs from that collection
- Expandable/collapsible
- Show total count
- Actions at collection level

### 4. Create NFT Page
**File: `/src/app_sneeddao_frontend/src/pages/Nft.jsx`**
**File: `/src/app_sneeddao_frontend/src/pages/Nft.css`**

Main NFT page structure:
- Header section (like Wallet)
- Authentication check
- Section for "My NFT Collections"
- Add Collection button (manual canister ID input)
- Display collections grouped by canister
- Empty state when no NFTs
- Loading states
- Error handling

### 5. Create NFT Modals

#### 5.1 SendNftModal
**File: `/src/app_sneeddao_frontend/src/SendNftModal.jsx`**
**File: `/src/app_sneeddao_frontend/src/SendNftModal.css`**

Modal for transferring NFTs:
- Recipient principal input
- Optional subaccount input
- Optional memo field
- Transfer confirmation
- Success/error feedback

#### 5.2 AddNftCollectionModal
**File: `/src/app_sneeddao_frontend/src/AddNftCollectionModal.jsx`**
**File: `/src/app_sneeddao_frontend/src/AddNftCollectionModal.css`**

Modal to add NFT collection:
- Canister ID input with validation
- Auto-fetch collection metadata on valid ID
- Show collection preview before adding
- Save to backend for persistence

### 6. Backend Integration

Add methods to backend canister (if not already present):
- Store user's NFT collection canister IDs
- Retrieve user's NFT collections
- Update collection list

### 7. Update Router
**File: `/src/app_sneeddao_frontend/src/App.jsx`**

Add route:
```jsx
<Route path="/nft" element={<Nft />} />
```

### 8. Update Navigation
Update the navigation menu to include link to `/nft` page.

## Design Patterns from Wallet.jsx to Follow

1. **State Management:**
   - Use useState for component state
   - Use useEffect for data loading on mount
   - Separate loading states per section

2. **Authentication:**
   - Use AuthContext for auth state
   - Check isAuthenticated before showing data
   - Redirect or show message if not authenticated

3. **Theming:**
   - Use ThemeContext for consistent styling
   - Apply theme colors to all components
   - Support light/dark mode

4. **Card-based Layout:**
   - Collapsible card headers
   - Click header to expand/collapse
   - Action buttons when expanded
   - Sections with SectionHeader component

5. **Data Loading:**
   - Show loading indicators
   - Handle errors gracefully
   - Provide refresh functionality
   - Cache data when appropriate

6. **Actor Creation:**
   - Create authenticated actors with identity
   - Pass agent with identity
   - Handle anonymous vs authenticated differently

7. **Modals:**
   - Use controlled modals with state
   - Pass callbacks for actions
   - Show feedback on success/error
   - Close on completion

8. **Formatting:**
   - Use utility functions for consistent formatting
   - Show principals with copy button
   - Truncate long strings with expand option
   - Format dates consistently

## NFT Display Considerations

1. **Image Loading:**
   - Support DataURLs
   - Support HTTP/HTTPS URLs
   - Lazy loading for performance
   - Fallback for missing images
   - Handle SVG safely

2. **Metadata Display:**
   - Support generic Value type from ICRC-3
   - Recursively display nested data
   - Format different types appropriately
   - Hide empty/null values

3. **Pagination:**
   - Support ICRC7 pagination (prev/take)
   - Load NFTs in batches for performance
   - "Load More" button for large collections
   - Virtual scrolling for very large collections

4. **Performance:**
   - Don't load all NFTs at once
   - Cache collection metadata
   - Optimize image loading
   - Debounce searches

## Security Considerations

1. **XSS Prevention:**
   - Sanitize SVG images
   - Validate URLs
   - Don't execute scripts from metadata
   - Use dangerouslySetInnerHTML carefully

2. **Validation:**
   - Validate canister IDs
   - Validate principals
   - Check transfer arguments
   - Handle malformed metadata

3. **Error Handling:**
   - Don't expose sensitive errors
   - Provide user-friendly messages
   - Log detailed errors for debugging
   - Handle network failures

## Implementation Order

1. ✅ Create ICRC7 actor interface files - **COMPLETE**
   - Created `/src/external/icrc7_ledger/icrc7_ledger.did`
   - Created `/src/external/icrc7_ledger/icrc7_ledger.did.js` (generated)
   - Created `/src/external/icrc7_ledger/index.js`

2. ✅ Create NftUtils.js with core functions - **COMPLETE**
   - Created `/src/app_sneeddao_frontend/src/utils/NftUtils.js`
   - Implemented all utility functions for NFT operations

3. ✅ Create NftCard component - **COMPLETE**
   - Created `/src/app_sneeddao_frontend/src/NftCard.jsx`
   - Created `/src/app_sneeddao_frontend/src/NftCard.css`

4. ✅ Create NftCollectionCard component - **COMPLETE**
   - Created `/src/app_sneeddao_frontend/src/NftCollectionCard.jsx`
   - Created `/src/app_sneeddao_frontend/src/NftCollectionCard.css`

5. ✅ Create SendNftModal component - **COMPLETE**
   - Created `/src/app_sneeddao_frontend/src/SendNftModal.jsx`
   - Created `/src/app_sneeddao_frontend/src/SendNftModal.css`

6. ✅ Create AddNftCollectionModal component - **COMPLETE**
   - Created `/src/app_sneeddao_frontend/src/AddNftCollectionModal.jsx`
   - Created `/src/app_sneeddao_frontend/src/AddNftCollectionModal.css`

7. ✅ Create main Nft.jsx page - **COMPLETE**
   - Created `/src/app_sneeddao_frontend/src/pages/Nft.jsx`
   - Created `/src/app_sneeddao_frontend/src/pages/Nft.css`

8. ✅ Update App.jsx with route - **COMPLETE**
   - Added import for Nft component
   - Added route `/nft` with Nft element

9. ✅ Add navigation links - **COMPLETE**
   - Updated Header.jsx to add NFT icon button next to Wallet
   - Added "NFTs" to the Me section submenu
   - Updated active section logic to include `/nft`

10. ✅ Handle edge cases and errors - **COMPLETE**
    - Authentication check with redirect prompt
    - Empty state handling
    - Loading states
    - Error handling for failed collections
    - Image loading fallbacks
    - Validation for canister IDs and principals

11. ✅ Polish UI/UX - **COMPLETE**
    - Responsive grid layout
    - Hover effects and animations
    - Theme support (light/dark mode)
    - Collapsible sections
    - Copy-to-clipboard functionality
    - Clean, modern design matching existing patterns

## Testing Strategy

1. Test with empty state (no NFTs)
2. Test with single NFT
3. Test with multiple collections
4. Test with large collections (pagination)
5. Test transfer functionality
6. Test error states (invalid canister, network errors)
7. Test with various metadata formats
8. Test image loading (DataURL, HTTP, SVG, missing)
9. Test theme switching
10. Test mobile responsiveness

## Notes

- Keep it simple and extensible
- Follow existing code patterns strictly
- Use same styling approach as Wallet
- Reuse utility functions where possible
- Add comments for complex logic
- Handle edge cases gracefully

---

## Implementation Summary

### Files Created

#### ICRC7 Actor Interface (3 files)
1. `/src/external/icrc7_ledger/icrc7_ledger.did` - Candid interface definition
2. `/src/external/icrc7_ledger/icrc7_ledger.did.js` - Generated JavaScript bindings
3. `/src/external/icrc7_ledger/index.js` - Actor factory (follows ICRC1 pattern)

#### Utility Functions (1 file)
4. `/src/app_sneeddao_frontend/src/utils/NftUtils.js` - NFT utility functions
   - `getNftImage()` - Extract image URL from metadata
   - `getNftName()` - Extract NFT name from metadata
   - `getNftDescription()` - Extract description from metadata
   - `formatValue()` - Format ICRC-3 Value types for display
   - `formatNftMetadata()` - Format metadata for display
   - `loadNftCollection()` - Load complete collection with user's NFTs
   - `transferNft()` - Transfer NFT with full error handling
   - `verifyIcrc7Support()` - Check if canister implements ICRC-7
   - `fetchCollectionInfo()` - Fetch basic collection info for preview

#### Components (8 files)
5. `/src/app_sneeddao_frontend/src/NftCard.jsx` - Individual NFT card component
6. `/src/app_sneeddao_frontend/src/NftCard.css` - NFT card styles
7. `/src/app_sneeddao_frontend/src/NftCollectionCard.jsx` - Collection container component
8. `/src/app_sneeddao_frontend/src/NftCollectionCard.css` - Collection card styles
9. `/src/app_sneeddao_frontend/src/SendNftModal.jsx` - Send NFT modal
10. `/src/app_sneeddao_frontend/src/SendNftModal.css` - Send modal styles
11. `/src/app_sneeddao_frontend/src/AddNftCollectionModal.jsx` - Add collection modal
12. `/src/app_sneeddao_frontend/src/AddNftCollectionModal.css` - Add modal styles

#### Main Page (2 files)
13. `/src/app_sneeddao_frontend/src/pages/Nft.jsx` - Main NFT page
14. `/src/app_sneeddao_frontend/src/pages/Nft.css` - NFT page styles

#### Updated Files (2 files)
15. `/src/app_sneeddao_frontend/src/App.jsx` - Added NFT route
16. `/src/app_sneeddao_frontend/src/components/Header.jsx` - Added NFT navigation

**Total: 16 files created/updated**

### Key Features Implemented

1. **Complete ICRC-7 Support**
   - Full implementation of ICRC-7 standard methods
   - ICRC-10 support verification
   - Proper handling of ICRC-3 Value types
   - Pagination support for large collections

2. **NFT Display**
   - Grid layout for NFT cards
   - Image display with fallback
   - Metadata viewing
   - Collection grouping
   - Expandable/collapsible UI

3. **NFT Management**
   - Add collections by canister ID
   - Remove collections
   - Refresh collection data
   - Send/transfer NFTs
   - View ownership information

4. **User Experience**
   - Responsive design
   - Theme support (light/dark)
   - Loading states
   - Error handling
   - Empty states
   - Authentication flow
   - Copy-to-clipboard
   - Validation feedback

5. **Navigation**
   - Quick access icon in header (🖼️)
   - Menu item in "Me" section
   - Route: `/nft`
   - Active state highlighting

### Design Patterns Used

- **Component Structure**: Follows TokenCard/PositionCard pattern
- **Modal Pattern**: Matches SendTokenModal pattern
- **State Management**: Uses React hooks (useState, useEffect)
- **Authentication**: Integrates with AuthContext
- **Theming**: Uses ThemeContext throughout
- **Agent Creation**: Follows existing actor creation patterns
- **Error Handling**: Comprehensive try-catch with user feedback
- **Styling**: Inline styles with theme variables (matches Wallet pattern)

### Storage

Currently uses localStorage for collection IDs with the key `nft_collections`. This can be upgraded to backend storage in the future by modifying the load/save logic in `Nft.jsx`.

### Next Steps for Enhancement

1. Backend storage integration for collection IDs
2. NFT metadata caching
3. Support for additional metadata standards
4. Batch transfer functionality
5. NFT filtering and search
6. Collection analytics/statistics
7. Integration with NFT marketplaces
8. Support for EXT standard migration

### Testing Recommendations

1. Test with ICRC-7 compatible canisters
2. Test with various metadata formats
3. Test image loading (HTTP, DataURL, SVG)
4. Test transfer functionality
5. Test with large collections (pagination)
6. Test error scenarios
7. Test theme switching
8. Test responsive layouts

