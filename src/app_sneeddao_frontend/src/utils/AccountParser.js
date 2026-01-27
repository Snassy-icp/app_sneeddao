// AccountParser.js - Utility for parsing ICRC-1 account addresses
import { Principal } from '@dfinity/principal';
import { decodeIcrcAccount, encodeIcrcAccount } from '@dfinity/ledger-icrc';
import { principalToSubAccount } from '@dfinity/utils';

/**
 * Parsed account interface:
 * {
 *   original?: string,           // Original extended address string if provided
 *   principal: Principal,
 *   subaccount?: {
 *     type: 'hex' | 'bytes' | 'principal' | 'extended_address',
 *     value: string,
 *     resolved: Uint8Array       // The actual 32-byte subaccount
 *   }
 * }
 */

/**
 * Parse any account input format
 * @param {string} input - The input string (can be principal, extended address, etc.)
 * @param {Object} subaccountInput - Optional subaccount input { type: 'hex' | 'bytes' | 'principal', value: string }
 * @returns {Object|null} - ParsedAccount or null if invalid
 */
export const parseAccount = (input, subaccountInput = null) => {
    if (!input || typeof input !== 'string') {
        return null;
    }

    const trimmed = input.trim();
    if (!trimmed) {
        return null;
    }

    // First, try to parse as extended address format (contains '.')
    if (trimmed.includes('.')) {
        const extendedResult = parseExtendedAddress(trimmed);
        if (extendedResult) {
            return extendedResult;
        }
        // If extended address parsing failed, continue to try as principal
    }

    // Try to parse as plain principal
    try {
        const principal = Principal.fromText(trimmed);
        
        // If subaccount input is provided, resolve it
        if (subaccountInput && subaccountInput.value && subaccountInput.value.trim()) {
            const resolvedSubaccount = resolveSubaccount(subaccountInput);
            if (resolvedSubaccount) {
                return {
                    principal,
                    subaccount: resolvedSubaccount
                };
            }
        }

        return { principal };
    } catch (e) {
        return null;
    }
};

/**
 * Parse extended address format (principal.checksum+subaccount)
 * @param {string} input - The extended address string
 * @returns {Object|null} - ParsedAccount or null if invalid
 */
export const parseExtendedAddress = (input) => {
    if (!input || typeof input !== 'string') {
        return null;
    }

    const trimmed = input.trim();
    if (!trimmed.includes('.')) {
        return null;
    }

    try {
        const decoded = decodeIcrcAccount(trimmed);
        
        if (!decoded || !decoded.owner) {
            return null;
        }

        const result = {
            original: trimmed,
            principal: decoded.owner
        };

        // If there's a subaccount, include it
        if (decoded.subaccount && decoded.subaccount.length > 0) {
            const subaccountBytes = new Uint8Array(decoded.subaccount);
            result.subaccount = {
                type: 'extended_address',
                value: bytesToHex(subaccountBytes),
                resolved: subaccountBytes
            };
        }

        return result;
    } catch (e) {
        console.error('Failed to parse extended address:', e);
        return null;
    }
};

/**
 * Resolve subaccount input to a 32-byte Uint8Array
 * @param {Object} subaccountInput - { type: 'hex' | 'bytes' | 'principal', value: string }
 * @returns {Object|null} - { type, value, resolved: Uint8Array } or null if invalid
 */
export const resolveSubaccount = (subaccountInput) => {
    if (!subaccountInput || !subaccountInput.type || !subaccountInput.value) {
        return null;
    }

    const { type, value } = subaccountInput;
    const trimmedValue = value.trim();

    if (!trimmedValue) {
        return null;
    }

    switch (type) {
        case 'hex':
            const hexBytes = hexToBytes(trimmedValue);
            if (hexBytes) {
                return {
                    type: 'hex',
                    value: trimmedValue,
                    resolved: hexBytes
                };
            }
            return null;

        case 'bytes':
            const byteArray = parseByteString(trimmedValue);
            if (byteArray) {
                return {
                    type: 'bytes',
                    value: trimmedValue,
                    resolved: byteArray
                };
            }
            return null;

        case 'principal':
            try {
                const principal = Principal.fromText(trimmedValue);
                const subaccountBytes = principalToSubAccount(principal);
                return {
                    type: 'principal',
                    value: trimmedValue,
                    resolved: new Uint8Array(subaccountBytes)
                };
            } catch (e) {
                return null;
            }

        default:
            return null;
    }
};

/**
 * Convert hex string to 32-byte Uint8Array (pads with zeros if shorter)
 * @param {string} hex - Hex string (with or without 0x prefix)
 * @returns {Uint8Array|null} - 32-byte array or null if invalid
 */
export const hexToBytes = (hex) => {
    if (!hex || typeof hex !== 'string') {
        return null;
    }

    // Remove 0x prefix if present
    let cleanHex = hex.trim();
    if (cleanHex.toLowerCase().startsWith('0x')) {
        cleanHex = cleanHex.slice(2);
    }

    // Remove any whitespace or dashes
    cleanHex = cleanHex.replace(/[\s-]/g, '');

    // Validate hex characters
    if (!/^[0-9a-fA-F]*$/.test(cleanHex)) {
        return null;
    }

    // Pad with zeros if shorter than 64 characters (32 bytes)
    // Note: we pad on the LEFT for proper subaccount interpretation
    if (cleanHex.length < 64) {
        cleanHex = cleanHex.padStart(64, '0');
    }

    // Truncate if longer than 64 characters
    if (cleanHex.length > 64) {
        cleanHex = cleanHex.slice(0, 64);
    }

    const bytes = new Uint8Array(32);
    for (let i = 0; i < 32; i++) {
        bytes[i] = parseInt(cleanHex.slice(i * 2, i * 2 + 2), 16);
    }

    return bytes;
};

/**
 * Parse comma-separated byte string to 32-byte Uint8Array
 * @param {string} input - Comma-separated decimal values (e.g., "1, 2, 3, 4")
 * @returns {Uint8Array|null} - 32-byte array or null if invalid
 */
export const parseByteString = (input) => {
    if (!input || typeof input !== 'string') {
        return null;
    }

    const trimmed = input.trim();
    if (!trimmed) {
        return null;
    }

    // Split by comma and parse each value
    const parts = trimmed.split(',').map(s => s.trim()).filter(s => s !== '');
    
    if (parts.length === 0 || parts.length > 32) {
        return null;
    }

    const bytes = new Uint8Array(32);
    for (let i = 0; i < parts.length; i++) {
        const num = parseInt(parts[i], 10);
        if (isNaN(num) || num < 0 || num > 255) {
            return null;
        }
        bytes[i] = num;
    }

    return bytes;
};

/**
 * Convert Uint8Array to hex string
 * @param {Uint8Array} bytes - Byte array
 * @returns {string} - Hex string
 */
export const bytesToHex = (bytes) => {
    if (!bytes || !(bytes instanceof Uint8Array)) {
        return '';
    }
    return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
};

/**
 * Encode account to extended address format
 * @param {Object} account - ParsedAccount with principal and optional subaccount
 * @returns {string|null} - Extended address string or null if invalid
 */
export const encodeExtendedAddress = (account) => {
    if (!account || !account.principal) {
        return null;
    }

    try {
        const icrcAccount = {
            owner: account.principal
        };

        if (account.subaccount && account.subaccount.resolved) {
            // Convert Uint8Array to regular array for the library
            icrcAccount.subaccount = Array.from(account.subaccount.resolved);
        }

        return encodeIcrcAccount(icrcAccount);
    } catch (e) {
        console.error('Failed to encode extended address:', e);
        return null;
    }
};

/**
 * Check if a subaccount is all zeros (default/empty subaccount)
 * @param {Uint8Array} subaccount - 32-byte subaccount
 * @returns {boolean} - True if all zeros
 */
export const isDefaultSubaccount = (subaccount) => {
    if (!subaccount || !(subaccount instanceof Uint8Array)) {
        return true;
    }
    return subaccount.every(byte => byte === 0);
};

/**
 * Format subaccount for display (truncated hex)
 * @param {Uint8Array} subaccount - 32-byte subaccount
 * @param {number} maxLength - Maximum display length
 * @returns {string} - Formatted hex string
 */
export const formatSubaccountForDisplay = (subaccount, maxLength = 16) => {
    if (!subaccount || !(subaccount instanceof Uint8Array)) {
        return '(none)';
    }
    
    if (isDefaultSubaccount(subaccount)) {
        return '(default)';
    }

    const hex = bytesToHex(subaccount);
    // Remove leading zeros for display
    const trimmedHex = hex.replace(/^0+/, '') || '0';
    
    if (trimmedHex.length <= maxLength) {
        return trimmedHex;
    }
    
    return trimmedHex.slice(0, maxLength / 2) + '...' + trimmedHex.slice(-maxLength / 2);
};

/**
 * Validate if input looks like an extended address format
 * @param {string} input - Input string
 * @returns {boolean} - True if it appears to be an extended address
 */
export const looksLikeExtendedAddress = (input) => {
    if (!input || typeof input !== 'string') {
        return false;
    }
    return input.trim().includes('.');
};

/**
 * Get the subaccount for ICRC-1 transfer (as optional array)
 * @param {Object} account - ParsedAccount
 * @returns {Array} - [] for no subaccount, [Array<number>] for subaccount
 */
export const getSubaccountForTransfer = (account) => {
    if (!account || !account.subaccount || !account.subaccount.resolved) {
        return [];
    }
    
    if (isDefaultSubaccount(account.subaccount.resolved)) {
        return [];
    }
    
    return [Array.from(account.subaccount.resolved)];
};

export default {
    parseAccount,
    parseExtendedAddress,
    resolveSubaccount,
    hexToBytes,
    parseByteString,
    bytesToHex,
    encodeExtendedAddress,
    isDefaultSubaccount,
    formatSubaccountForDisplay,
    looksLikeExtendedAddress,
    getSubaccountForTransfer
};
