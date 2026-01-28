// DateUtils.js

const get_short_timezone = () => {
    const date = new Date();
    const shortTimezone = date.toLocaleTimeString('en-us', { timeZoneName: 'short' }).split(' ')[2];
    return shortTimezone;
};

/**
 * Returns a human-readable relative time string (e.g., "5 minutes ago", "2 days ago")
 * @param {number|bigint} timestamp - Timestamp in nanoseconds (IC format) or milliseconds
 * @param {boolean} isNanoseconds - If true, converts from nanoseconds to milliseconds
 * @returns {string} Relative time string
 */
const getRelativeTime = (timestamp, isNanoseconds = true) => {
    const ms = isNanoseconds ? Number(timestamp) / 1_000_000 : Number(timestamp);
    const now = Date.now();
    const diff = now - ms;
    
    const seconds = Math.floor(diff / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);
    const weeks = Math.floor(days / 7);
    const months = Math.floor(days / 30);
    const years = Math.floor(days / 365);
    
    if (seconds < 60) return 'just now';
    if (minutes === 1) return '1 minute ago';
    if (minutes < 60) return `${minutes} minutes ago`;
    if (hours === 1) return '1 hour ago';
    if (hours < 24) return `${hours} hours ago`;
    if (days === 1) return 'yesterday';
    if (days < 7) return `${days} days ago`;
    if (weeks === 1) return '1 week ago';
    if (weeks < 4) return `${weeks} weeks ago`;
    if (months === 1) return '1 month ago';
    if (months < 12) return `${months} months ago`;
    if (years === 1) return '1 year ago';
    return `${years} years ago`;
};

/**
 * Returns the full formatted date for tooltip display
 * @param {number|bigint} timestamp - Timestamp in nanoseconds (IC format) or milliseconds
 * @param {boolean} isNanoseconds - If true, converts from nanoseconds to milliseconds
 * @returns {string} Full formatted date string
 */
const getFullDate = (timestamp, isNanoseconds = true) => {
    const ms = isNanoseconds ? Number(timestamp) / 1_000_000 : Number(timestamp);
    const date = new Date(ms);
    return date.toLocaleString('en-US', {
        weekday: 'short',
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    });
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
    getInitialExpiry,
    getRelativeTime,
    getFullDate
};