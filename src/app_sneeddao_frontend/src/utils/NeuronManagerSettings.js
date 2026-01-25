// Neuron Manager Settings - stored in localStorage
// Default thresholds for cycle warnings (in cycles, where 1T = 1_000_000_000_000)

const STORAGE_KEY = 'neuronManagerSettings';
const CANISTER_STORAGE_KEY = 'canisterManagerSettings';

const DEFAULT_SETTINGS = {
    cycleThresholdRed: 1_000_000_000_000,    // 1T - critical
    cycleThresholdOrange: 5_000_000_000_000, // 5T - warning
};

/**
 * Get neuron manager settings from localStorage
 * @returns {Object} Settings object with cycleThresholdRed and cycleThresholdOrange
 */
export function getNeuronManagerSettings() {
    try {
        const stored = localStorage.getItem(STORAGE_KEY);
        if (stored) {
            const parsed = JSON.parse(stored);
            return {
                cycleThresholdRed: parsed.cycleThresholdRed ?? DEFAULT_SETTINGS.cycleThresholdRed,
                cycleThresholdOrange: parsed.cycleThresholdOrange ?? DEFAULT_SETTINGS.cycleThresholdOrange,
            };
        }
    } catch (e) {
        console.warn('Error reading neuron manager settings:', e);
    }
    return { ...DEFAULT_SETTINGS };
}

/**
 * Save neuron manager settings to localStorage
 * @param {Object} settings - Settings object with cycleThresholdRed and cycleThresholdOrange
 */
export function saveNeuronManagerSettings(settings) {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({
            cycleThresholdRed: settings.cycleThresholdRed,
            cycleThresholdOrange: settings.cycleThresholdOrange,
        }));
    } catch (e) {
        console.warn('Error saving neuron manager settings:', e);
    }
}

/**
 * Get canister manager settings from localStorage
 * @returns {Object} Settings object with cycleThresholdRed and cycleThresholdOrange
 */
export function getCanisterManagerSettings() {
    try {
        const stored = localStorage.getItem(CANISTER_STORAGE_KEY);
        if (stored) {
            const parsed = JSON.parse(stored);
            return {
                cycleThresholdRed: parsed.cycleThresholdRed ?? DEFAULT_SETTINGS.cycleThresholdRed,
                cycleThresholdOrange: parsed.cycleThresholdOrange ?? DEFAULT_SETTINGS.cycleThresholdOrange,
            };
        }
    } catch (e) {
        console.warn('Error reading canister manager settings:', e);
    }
    return { ...DEFAULT_SETTINGS };
}

/**
 * Save canister manager settings to localStorage
 * @param {Object} settings - Settings object with cycleThresholdRed and cycleThresholdOrange
 */
export function saveCanisterManagerSettings(settings) {
    try {
        localStorage.setItem(CANISTER_STORAGE_KEY, JSON.stringify({
            cycleThresholdRed: settings.cycleThresholdRed,
            cycleThresholdOrange: settings.cycleThresholdOrange,
        }));
    } catch (e) {
        console.warn('Error saving canister manager settings:', e);
    }
}

/**
 * Get the color for a cycles value based on thresholds
 * @param {number|bigint} cycles - The cycles value
 * @param {Object} settings - Optional settings object (will use defaults if not provided)
 * @returns {string} Color code - '#ef4444' (red), '#f59e0b' (orange), or '#22c55e' (green)
 */
export function getCyclesColor(cycles, settings = null) {
    const { cycleThresholdRed, cycleThresholdOrange } = settings || getNeuronManagerSettings();
    const cyclesNum = typeof cycles === 'bigint' ? Number(cycles) : cycles;
    
    if (cyclesNum < cycleThresholdRed) {
        return '#ef4444'; // red
    } else if (cyclesNum < cycleThresholdOrange) {
        return '#f59e0b'; // orange
    } else {
        return '#22c55e'; // green
    }
}

/**
 * Format cycles for display (e.g., "1.5T", "500B")
 * @param {number|bigint} cycles - The cycles value
 * @returns {string} Formatted string
 */
export function formatCyclesCompact(cycles) {
    const cyclesNum = typeof cycles === 'bigint' ? Number(cycles) : cycles;
    
    if (cyclesNum >= 1_000_000_000_000) {
        return `${(cyclesNum / 1_000_000_000_000).toFixed(1)}T`;
    } else if (cyclesNum >= 1_000_000_000) {
        return `${(cyclesNum / 1_000_000_000).toFixed(1)}B`;
    } else if (cyclesNum >= 1_000_000) {
        return `${(cyclesNum / 1_000_000).toFixed(1)}M`;
    } else {
        return cyclesNum.toLocaleString();
    }
}

/**
 * Parse a user-input cycles value (e.g., "1T", "500B", "1000000000000")
 * @param {string} input - The user input
 * @returns {number|null} The parsed cycles value, or null if invalid
 */
export function parseCyclesInput(input) {
    if (!input || typeof input !== 'string') return null;
    
    const trimmed = input.trim().toUpperCase();
    
    // Try parsing with suffix
    const match = trimmed.match(/^([\d.]+)\s*(T|B|M)?$/);
    if (match) {
        const num = parseFloat(match[1]);
        if (isNaN(num)) return null;
        
        const suffix = match[2];
        if (suffix === 'T') return num * 1_000_000_000_000;
        if (suffix === 'B') return num * 1_000_000_000;
        if (suffix === 'M') return num * 1_000_000;
        return num;
    }
    
    return null;
}

