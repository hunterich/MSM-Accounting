import React, { useState, useRef, useEffect } from 'react';
import { ChevronDown } from 'lucide-react';

interface PrimaryAction {
    label: string;
    icon?: React.ReactNode;
    onClick?: () => void;
}
interface OptionAction {
    label: string;
    icon?: React.ReactNode;
    onClick?: () => void;
    disabled?: boolean;
}

interface SplitButtonProps {
    primary: PrimaryAction;
    options: OptionAction[];
    variant?: 'primary';
    size?: 'sm' | 'md' | 'lg';
    className?: string;
}

const heightMap = { sm: 'h-7', md: 'h-[34px]', lg: 'h-10' };

const SplitButton = ({
    primary,
    options,
    variant = 'primary',
    size = 'md',
    className = '',
}: SplitButtonProps): React.ReactElement => {
    const [open, setOpen] = useState(false);
    const ref = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const handler = (e: MouseEvent) => {
            if (!ref.current?.contains(e.target as Node)) setOpen(false);
        };
        const escHandler = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
        document.addEventListener('mousedown', handler);
        document.addEventListener('keydown', escHandler);
        return () => {
            document.removeEventListener('mousedown', handler);
            document.removeEventListener('keydown', escHandler);
        };
    }, []);

    const variantStyle =
        variant === 'primary'
            ? {
                main: 'bg-primary-700 text-white hover:bg-primary-800',
                divider: 'border-l border-white/20',
                caret: 'bg-primary-700 text-white hover:bg-primary-800',
            }
            : { main: '', divider: '', caret: '' };

    const h = heightMap[size];

    return (
        <div className={`relative inline-flex ${className}`} ref={ref}>
            <button
                type="button"
                onClick={primary.onClick}
                className={`${h} inline-flex items-center gap-2 px-3.5 text-[13px] font-medium rounded-l-md transition-colors ${variantStyle.main}`}
            >
                {primary.icon && <span className="inline-flex">{primary.icon}</span>}
                <span>{primary.label}</span>
            </button>
            <button
                type="button"
                onClick={() => setOpen(o => !o)}
                aria-haspopup="menu"
                aria-expanded={open}
                aria-label="More save options"
                className={`${h} px-2 rounded-r-md transition-colors ${variantStyle.caret} ${variantStyle.divider}`}
            >
                <ChevronDown size={14} />
            </button>
            {open && (
                <div
                    role="menu"
                    className="absolute top-full right-0 mt-1 min-w-[220px] bg-white border border-neutral-200 rounded-md shadow-lg py-1 z-50"
                >
                    {options.map((opt, i) => (
                        <button
                            key={i}
                            role="menuitem"
                            disabled={opt.disabled}
                            onClick={() => {
                                setOpen(false);
                                opt.onClick?.();
                            }}
                            className="w-full text-left px-3 py-2 text-[13px] text-neutral-800 hover:bg-neutral-50 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                        >
                            {opt.icon && <span className="text-neutral-500 inline-flex">{opt.icon}</span>}
                            <span>{opt.label}</span>
                        </button>
                    ))}
                </div>
            )}
        </div>
    );
};

export default SplitButton;
