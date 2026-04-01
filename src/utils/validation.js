/**
 * Reusable form validation utilities for MSM Accounting Software.
 * Each validator returns null if valid, or an error string if invalid.
 */

export const required = (value, fieldName) => {
    if (value === null || value === undefined) return `${fieldName} is required.`;
    if (typeof value === 'string' && !value.trim()) return `${fieldName} is required.`;
    if (Array.isArray(value) && value.length === 0) return `${fieldName} is required.`;
    return null;
};

export const positiveNumber = (value, fieldName) => {
    const num = Number(value);
    if (isNaN(num)) return `${fieldName} must be a number.`;
    if (num < 0) return `${fieldName} cannot be negative.`;
    return null;
};

export const greaterThanZero = (value, fieldName) => {
    const num = Number(value);
    if (isNaN(num)) return `${fieldName} must be a number.`;
    if (num <= 0) return `${fieldName} must be greater than zero.`;
    return null;
};

export const numberRange = (value, min, max, fieldName) => {
    const num = Number(value);
    if (isNaN(num)) return `${fieldName} must be a number.`;
    if (num < min || num > max) return `${fieldName} must be between ${min} and ${max}.`;
    return null;
};

export const dateNotBefore = (dateValue, referenceDate, message) => {
    if (!dateValue || !referenceDate) return null;
    return dateValue < referenceDate ? message : null;
};

export const dateRequired = (value, fieldName) => {
    if (!value) return `${fieldName} is required.`;
    const d = new Date(value);
    if (isNaN(d.getTime())) return `${fieldName} is not a valid date.`;
    return null;
};

export const duplicateId = (id, existingIds, fieldName) => {
    if (!id) return null;
    return existingIds.includes(id) ? `${fieldName} already exists.` : null;
};

export const emailFormat = (value, fieldName) => {
    if (!value) return null; // optional
    const pattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return pattern.test(value) ? null : `${fieldName} is not a valid email.`;
};

export const minItems = (items, min, message) => {
    if (!Array.isArray(items)) return message;
    return items.length < min ? message : null;
};

/**
 * Collect multiple validation results into an errors object.
 * Usage:
 *   const errors = collectErrors(
 *     ['name', required(name, 'Name')],
 *     ['amount', greaterThanZero(amount, 'Amount')],
 *   );
 * Returns: { name: 'Name is required.' } or {} if all valid
 */
export const collectErrors = (...checks) => {
    const errors = {};
    checks.forEach(([key, error]) => {
        if (error) errors[key] = error;
    });
    return errors;
};

/**
 * Check if an errors object has any errors.
 */
export const hasErrors = (errors) => {
    return Object.values(errors).some(Boolean);
};
