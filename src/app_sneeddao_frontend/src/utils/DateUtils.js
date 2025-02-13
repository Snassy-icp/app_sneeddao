// DateUtils.js

const get_short_timezone = () => {
    const date = new Date();
    const shortTimezone = date.toLocaleTimeString('en-us', { timeZoneName: 'short' }).split(' ')[2];
    return shortTimezone;
};

const format_duration = (milliseconds) => {
    const totalSeconds = Math.floor(milliseconds / 1000);
    const years = Math.floor(totalSeconds / (365 * 24 * 60 * 60));
    const days = Math.floor((totalSeconds % (365 * 24 * 60 * 60)) / (24 * 60 * 60));
    const hours = Math.floor((totalSeconds % (24 * 60 * 60)) / (60 * 60));
    const minutes = Math.floor((totalSeconds % (60 * 60)) / 60);
    const seconds = totalSeconds % 60;

    let durationString = '';
    if (years > 0) durationString += `${years} years `;
    if (days > 0) durationString += `${days} days `;
    if (years === 0 && days <= 7 && hours > 0) durationString += `${hours} hours `;
    if (years === 0 && days === 0 && minutes > 0) durationString += `${minutes} minutes `;
    if (years === 0 && days === 0 && hours === 0 && seconds > 0) durationString += `${seconds} seconds`;

    return durationString.trim();
};

const bigDateToReadable = (bigDate) => {
    const nano_to_milli = Number(1000000);
    const time = Number(bigDate) / nano_to_milli;
    const date = new Date(time);
    return dateToReadable(date);
};

const dateToReadable = (date) => {
    return date.toLocaleString('en-us', { year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "numeric" });
    // return date.toLocaleString('en-us', { weekday: "long", year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "numeric" });
    // return new Date(Number(bigDate) / (10 ** 6));
};

const getInitialExpiry = () => {
    const date = new Date(Date.now() + 5 * 60000); // Current time + 5 minutes
    return date.getFullYear() + '-' +
           String(date.getMonth() + 1).padStart(2, '0') + '-' +
           String(date.getDate()).padStart(2, '0') + 'T' +
           String(date.getHours()).padStart(2, '0') + ':' +
           String(date.getMinutes()).padStart(2, '0');
};    

export { 
    get_short_timezone,
    format_duration,
    bigDateToReadable,
    dateToReadable,
    getInitialExpiry
};