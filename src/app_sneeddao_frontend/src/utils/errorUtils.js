/**
 * Formats a ForumError object into a readable error message
 * @param {Object} error - The ForumError object from the backend
 * @returns {string} - A human-readable error message
 */
export const formatForumError = (error) => {
    if (!error || typeof error !== 'object') {
        return 'Unknown error occurred';
    }

    // Handle the different ForumError variants
    if (error.NotFound) {
        return `Not found: ${error.NotFound}`;
    }
    
    if (error.Unauthorized) {
        return `Unauthorized: ${error.Unauthorized}`;
    }
    
    if (error.InvalidInput) {
        return `Invalid input: ${error.InvalidInput}`;
    }
    
    if (error.AlreadyExists) {
        return `Already exists: ${error.AlreadyExists}`;
    }
    
    if (error.InternalError) {
        return `Internal error: ${error.InternalError}`;
    }

    // Fallback for any unexpected error structure
    try {
        return JSON.stringify(error);
    } catch {
        return 'Unknown error occurred';
    }
};

/**
 * Formats any error (including network errors, ForumError objects, etc.) into a readable message
 * @param {any} error - The error to format
 * @param {string} defaultMessage - Default message if error can't be formatted
 * @returns {string} - A human-readable error message
 */
export const formatError = (error, defaultMessage = 'An error occurred') => {
    if (!error) {
        return defaultMessage;
    }

    // If it's a string, return as is
    if (typeof error === 'string') {
        return error;
    }

    // If it has a message property (standard Error objects)
    if (error.message) {
        return error.message;
    }

    // If it looks like a ForumError object
    if (typeof error === 'object' && (
        error.NotFound || error.Unauthorized || error.InvalidInput || 
        error.AlreadyExists || error.InternalError
    )) {
        return formatForumError(error);
    }

    // Try to stringify the error object
    try {
        const errorString = JSON.stringify(error);
        if (errorString !== '{}') {
            return errorString;
        }
    } catch {
        // JSON.stringify failed
    }

    return defaultMessage;
};
