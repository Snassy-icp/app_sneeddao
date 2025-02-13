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
    fractionalPart = fractionalPart.replace(/0+$/, '');

    // Always format integer part with commas
    const formattedIntegerPart = Number(integerPart).toLocaleString();

    // Show decimals only if the value is less than 1000
    if (Number(integerPart) < 1000 && fractionalPart) {
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

    // Show 2 decimals only if the value is less than 1000
    if (finalAmount < 1000) {
        return finalAmount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }
    return finalAmount.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 });
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