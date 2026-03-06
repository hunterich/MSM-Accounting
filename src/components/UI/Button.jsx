import React from 'react';

const variantClasses = {
    primary: 'bg-primary-700 text-neutral-0 not-disabled:hover:bg-primary-800',
    secondary: 'bg-neutral-100 text-neutral-700 border border-neutral-300 not-disabled:hover:bg-neutral-200',
    tertiary: 'bg-transparent text-primary-700 not-disabled:hover:bg-primary-100',
    danger: 'bg-danger-500 text-neutral-0 not-disabled:hover:bg-danger-600',
};

const sizeClasses = {
    small: 'h-8 text-sm px-3',
    medium: 'h-10 text-base px-4',
    large: 'h-12 text-lg px-6',
};

const Button = ({ text, children, variant = 'primary', size = 'medium', type = 'button', onClick, disabled = false, icon = null, className = '', ...props }) => {
    return (
        <button
            type={type}
            className={`inline-flex items-center justify-center border-none rounded-md font-medium cursor-pointer transition-all duration-150 gap-2 whitespace-nowrap disabled:opacity-60 disabled:cursor-not-allowed ${variantClasses[variant] || variantClasses.primary} ${sizeClasses[size] || sizeClasses.medium} ${className}`}
            disabled={disabled}
            onClick={onClick}
            {...props}
        >
            {icon && <span className="inline-flex items-center justify-center">{icon}</span>}
            <span>{text || children}</span>
        </button>
    );
};

export default Button;
