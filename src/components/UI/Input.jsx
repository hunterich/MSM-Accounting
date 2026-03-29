import React from 'react';

/**
 * @param {{
 *   label?: string;
 *   id?: string;
 *   name?: string;
 *   type?: string;
 *   placeholder?: string;
 *   value?: string | number | readonly string[];
 *   required?: boolean;
 *   disabled?: boolean;
 *   error?: string | null;
 *   onChange?: import('react').ChangeEventHandler<HTMLInputElement>;
 *   className?: string;
 *   wrapperClassName?: string;
 *   inputClassName?: string;
 *   style?: import('react').CSSProperties;
 *   helperText?: string;
 *   [key: string]: any;
 * }} props
 */
const Input = ({
    label = undefined,
    id = undefined,
    name,
    type = 'text',
    placeholder = '',
    value,
    required = false,
    disabled = false,
    error = undefined,
    onChange,
    className = '',
    wrapperClassName = undefined,
    inputClassName = '',
    style = undefined
}) => {
    return (
        <div className={wrapperClassName !== undefined ? wrapperClassName : `mb-4 ${className}`}>
            {label && (
                <label htmlFor={id} className="block mb-2 text-sm font-medium text-neutral-700">
                    {label}
                    {required && <span className="text-danger-500"> *</span>}
                </label>
            )}

            <input
                id={id}
                name={name || id}
                type={type}
                className={`block w-full px-3 text-base leading-normal text-neutral-900 bg-neutral-0 bg-clip-padding border rounded-md transition-[border-color,box-shadow] duration-150 min-h-10 focus:border-primary-500 focus:outline-0 focus:shadow-[0_0_0_3px_var(--color-primary-100)] ${error ? 'border-danger-500' : 'border-neutral-300'} ${inputClassName}`}
                placeholder={placeholder}
                value={value}
                disabled={disabled}
                required={required}
                onChange={onChange}
                style={style}
            />

            {error && (
                <div className="w-full mt-1 text-xs text-danger-500">{error}</div>
            )}
        </div>
    );
};

export default Input;
