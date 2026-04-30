import React from 'react';

type Variant = 'primary' | 'secondary' | 'tertiary' | 'ghost' | 'danger' | 'dangerSolid';
type Size = 'sm' | 'md' | 'lg' | 'icon' | 'small' | 'medium' | 'large';

const variantClasses: Record<Variant, string> = {
    primary:     'bg-primary-700 text-white not-disabled:hover:bg-primary-800 focus-visible:ring-2 focus-visible:ring-primary-300 focus-visible:ring-offset-1',
    secondary:   'bg-white text-neutral-800 border border-neutral-300 not-disabled:hover:bg-neutral-50 not-disabled:hover:border-neutral-400 focus-visible:ring-2 focus-visible:ring-primary-300',
    tertiary:    'bg-transparent text-primary-700 not-disabled:hover:bg-primary-100 focus-visible:ring-2 focus-visible:ring-primary-300',
    ghost:       'bg-transparent text-neutral-700 not-disabled:hover:bg-neutral-100 focus-visible:ring-2 focus-visible:ring-primary-300',
    danger:      'bg-danger-50 text-danger-700 border border-danger-200 not-disabled:hover:bg-danger-100 not-disabled:hover:border-danger-500 focus-visible:ring-2 focus-visible:ring-danger-200',
    dangerSolid: 'bg-danger-600 text-white not-disabled:hover:bg-danger-700 focus-visible:ring-2 focus-visible:ring-danger-200',
};

const sizeClasses: Record<string, string> = {
    sm:     'h-7 text-xs px-2.5 gap-1.5',
    md:     'h-[34px] text-[13px] px-3.5 gap-2',
    lg:     'h-10 text-sm px-4 gap-2',
    icon:   'h-[30px] w-[30px] p-0 gap-0',
    small:  'h-7 text-xs px-2.5 gap-1.5',
    medium: 'h-[34px] text-[13px] px-3.5 gap-2',
    large:  'h-10 text-sm px-4 gap-2',
};

interface ButtonProps {
    text?: React.ReactNode;
    children?: React.ReactNode;
    variant?: Variant;
    size?: Size;
    type?: 'button' | 'submit' | 'reset';
    onClick?: (event: React.MouseEvent<HTMLButtonElement>) => void;
    disabled?: boolean;
    loading?: boolean;
    icon?: React.ReactNode;
    iconRight?: React.ReactNode;
    className?: string;
    'aria-label'?: string;
    [key: string]: unknown;
}

const Button = ({
    text,
    children,
    variant = 'primary',
    size = 'md',
    type = 'button',
    onClick,
    disabled = false,
    loading = false,
    icon = null,
    iconRight = null,
    className = '',
    ...props
}: ButtonProps): React.ReactElement => {
    const v = variantClasses[variant] || variantClasses.primary;
    const s = sizeClasses[size] || sizeClasses.md;
    const isDisabled = disabled || loading;
    const label = text ?? children;

    return (
        <button
            type={type}
            disabled={isDisabled}
            onClick={onClick}
            className={`inline-flex items-center justify-center rounded-md font-medium whitespace-nowrap cursor-pointer transition-all duration-150 outline-none disabled:opacity-50 disabled:cursor-not-allowed ${v} ${s} ${className}`}
            {...props}
        >
            {loading ? (
                <span
                    aria-hidden
                    className="inline-block rounded-full border-2 border-current border-r-transparent animate-spin"
                    style={{ width: 14, height: 14 }}
                />
            ) : (
                icon && <span className="inline-flex items-center justify-center">{icon}</span>
            )}
            {label != null && size !== 'icon' && <span>{label}</span>}
            {iconRight && size !== 'icon' && <span className="inline-flex items-center justify-center">{iconRight}</span>}
        </button>
    );
};

export default Button;
