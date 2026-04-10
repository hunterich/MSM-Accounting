/**
 * Reusable form validation utilities for MSM Accounting Software.
 * Each validator returns null if valid, or an error string if invalid.
 */

export const required = (
    value: unknown,
    fieldName: string,
): string | null => {
    if (value === null || value === undefined) return `${fieldName} is required.`;
    if (typeof value === 'string' && !value.trim()) return `${fieldName} is required.`;
    if (Array.isArray(value) && value.length === 0) return `${fieldName} is required.`;
    return null;
};

export const positiveNumber = (
    value: unknown,
    fieldName: string,
): string | null => {
    const num = Number(value);
    if (isNaN(num)) return `${fieldName} must be a number.`;
    if (num < 0) return `${fieldName} cannot be negative.`;
    return null;
};

export const greaterThanZero = (
    value: unknown,
    fieldName: string,
): string | null => {
    const num = Number(value);
    if (isNaN(num)) return `${fieldName} must be a number.`;
    if (num <= 0) return `${fieldName} must be greater than zero.`;
    return null;
};

export const numberRange = (
    value: unknown,
    min: number,
    max: number,
    fieldName: string,
): string | null => {
    const num = Number(value);
    if (isNaN(num)) return `${fieldName} must be a number.`;
    if (num < min || num > max) return `${fieldName} must be between ${min} and ${max}.`;
    return null;
};

export const dateNotBefore = (
    dateValue: string | null | undefined,
    referenceDate: string | null | undefined,
    message: string,
): string | null => {
    if (!dateValue || !referenceDate) return null;
    return dateValue < referenceDate ? message : null;
};

export const dateRequired = (
    value: unknown,
    fieldName: string,
): string | null => {
    if (!value) return `${fieldName} is required.`;
    const d = new Date(String(value));
    if (isNaN(d.getTime())) return `${fieldName} is not a valid date.`;
    return null;
};

export const duplicateId = (
    id: unknown,
    existingIds: unknown[],
    fieldName: string,
): string | null => {
    if (!id) return null;
    return existingIds.includes(id) ? `${fieldName} already exists.` : null;
};

export const emailFormat = (
    value: unknown,
    fieldName: string,
): string | null => {
    if (!value) return null; // optional
    const pattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return pattern.test(String(value)) ? null : `${fieldName} is not a valid email.`;
};

export const minItems = (
    items: unknown,
    min: number,
    message: string,
): string | null => {
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
export const collectErrors = (
    ...checks: [string, string | null][]
): Record<string, string> => {
    const errors: Record<string, string> = {};
    checks.forEach(([key, error]) => {
        if (error) errors[key] = error;
    });
    return errors;
};

/**
 * Check if an errors object has any errors.
 */
export const hasErrors = (errors: Record<string, unknown>): boolean => {
    return Object.values(errors).some(Boolean);
};
