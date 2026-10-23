import { maskIfPrivate } from './privacyMode';

function toJsonString(o) {
    return JSON.stringify(o, (key, value) =>
        typeof value === 'bigint'
            ? value.toString()
            : value // return everything else unchanged
    );
  }

/**
 * Display a token amount (base units → "1,234.5"). Masked while privacy mode is on; use
 * formatAmountShown where the user must see the figure (the review step of a send), and
 * formatAmountRaw for input fields.
 */
const formatAmount = (amount, decimals) => maskIfPrivate(formatAmountShown(amount, decimals));

/** formatAmount that ignores privacy mode: for amounts the user is about to sign. */
const formatAmountShown = (amount, decimals) => {
    const balanceBigInt = BigInt(amount);
    const decimalsBigInt = BigInt(decimals);
    const divisor = 10n ** decimalsBigInt;
    const integerPart = (balanceBigInt / divisor).toString();
    let fractionalPart = (balanceBigInt % divisor).toString().padStart(Number(decimals), '0');
    fractionalPart = fractionalPart.replace(/0+$/, ''); // Remove trailing zeros

    // Always format integer part with commas
    const formattedIntegerPart = Number(integerPart).toLocaleString();

    // Show decimals as needed (if there are any non-zero decimals)
    if (fractionalPart) {
        return `${formattedIntegerPart}.${fractionalPart}`;
    }
    return formattedIntegerPart;
};

const formatAmountWithConversion = (amount, decimals, conversion_rate) => {
    // Handle undefined/null values from cache
    if (amount === undefined || amount === null) {
        return '0.00';
    }
    const balanceBigInt = BigInt(amount);
    const decimalsBigInt = BigInt(decimals || 8);
    const divisor = 10n ** decimalsBigInt;
    const value = Number(balanceBigInt) / Number(divisor);
    const finalAmount = value * (conversion_rate || 0);

    // Always show 2 decimals for USD amounts with commas
    return finalAmount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

/** Compute the raw USD numeric value from a token amount + conversion rate. */
const computeUsdValue = (amount, decimals, conversion_rate) => {
    if (amount === undefined || amount === null || !conversion_rate) return 0;
    const divisor = 10n ** BigInt(decimals || 8);
    return Number(BigInt(amount)) / Number(divisor) * conversion_rate;
};

/**
 * Render a denomination-aware inline value.
 * When denomFormatFn is provided, computes the USD value and delegates formatting
 * to the denomination context (supports any currency). Without it, falls back to
 * the original hardcoded USD behaviour.
 */
function getUSD(amount, decimals, conversion_rate, denomFormatFn) {
    if (amount > 0n && conversion_rate > 0) {
        if (denomFormatFn) {
            const usdVal = computeUsdValue(amount, decimals, conversion_rate);
            return (<i className="usd-text"> • {maskIfPrivate(denomFormatFn(usdVal))}</i>);
        }
        const usd = formatAmountWithConversion(amount, decimals, conversion_rate);
        return (<i className="usd-text"> • {maskIfPrivate(`$${usd}`)}</i>);
    }
    return (<i></i>);
}

const subaccountToHex = (subaccount) => {
    if (!subaccount || subaccount.length === 0) return '';
    
    // Convert the subaccount array to a hex string
    const bytes = Array.isArray(subaccount) ? subaccount : Array.from(subaccount);
    return bytes.map(byte => {
        const hex = byte.toString(16);
        return hex.length === 1 ? '0' + hex : hex;
    }).join('');
};

/** Format a BigInt amount as a plain decimal string (no commas) suitable for input fields. */
const formatAmountRaw = (amount, decimals) => {
    const balanceBigInt = BigInt(amount);
    const decimalsBigInt = BigInt(decimals);
    const divisor = 10n ** decimalsBigInt;
    const integerPart = (balanceBigInt / divisor).toString();
    let fractionalPart = (balanceBigInt % divisor).toString().padStart(Number(decimals), '0');
    fractionalPart = fractionalPart.replace(/0+$/, '');

    if (fractionalPart) {
        return `${integerPart}.${fractionalPart}`;
    }
    return integerPart;
};

/** Parse a decimal string (e.g. "1.5") into a BigInt in base units, using string manipulation to avoid float precision loss. */
const parseAmountToBigInt = (input, decimals) => {
    const str = String(input).replace(/,/g, ''); // strip any commas
    const [integerPart, decimalPart = ''] = str.split('.');
    const paddedDecimal = decimalPart.padEnd(decimals, '0').slice(0, decimals);
    return BigInt((integerPart || '0') + paddedDecimal);
};

export {
    toJsonString,
    formatAmount,
    formatAmountShown,
    formatAmountRaw,
    formatAmountWithConversion,
    computeUsdValue,
    parseAmountToBigInt,
    getUSD,
    subaccountToHex
};