function toJsonString(o) {
    return JSON.stringify(o, (key, value) =>
        typeof value === 'bigint'
            ? value.toString()
            : value // return everything else unchanged
    );
  }

const formatAmount = (amount, decimals) => {
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
    const balanceBigInt = BigInt(amount);
    const decimalsBigInt = BigInt(decimals);
    const divisor = 10n ** decimalsBigInt;
    const value = Number(balanceBigInt) / Number(divisor);
    const finalAmount = value * conversion_rate;

    // Always show 2 decimals for USD amounts with commas
    return finalAmount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

function getUSD(amount, decimals, conversion_rate) {
    if (amount > 0n && conversion_rate > 0) {
        const usd = formatAmountWithConversion(amount, decimals, conversion_rate);
        return (<i className="usd-text"> • ${usd}</i>);
    }
    return (<i></i>);
}

export { 
    toJsonString,
    formatAmount,
    formatAmountWithConversion,
    getUSD
};