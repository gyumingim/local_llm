// Exchange Rate Display Tool
// Current rate: 1 USD = 1,508.01 KRW (as of 05:04 UTC)

function displayExchangeRate() {
    const usdToKrwRate = 1508.01;
    console.log(`Current Exchange Rate: 1 USD = ${usdToKrwRate} KRW`);
    return usdToKrwRate;
}

function convertCurrency(amount, fromCurrency, toCurrency) {
    const rates = {
        'USD-KRW': 1508.01,
        'KRW-USD': 1/1508.01
    };
    
    const key = `${fromCurrency}-${toCurrency}`;
    if (rates[key]) {
        return amount * rates[key];
    } else {
        throw new Error(`Conversion from ${fromCurrency} to ${toCurrency} not supported`);
    }
}

// Display current rate
displayExchangeRate();

// Example conversions
console.log("Example Conversions:");
console.log(`100 USD = ${convertCurrency(100, 'USD', 'KRW')} KRW`);
console.log(`1000000 KRW = ${convertCurrency(1000000, 'KRW', 'USD')} USD`);

module.exports = {
    displayExchangeRate,
    convertCurrency
};