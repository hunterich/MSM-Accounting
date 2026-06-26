import React, { useState, useEffect, useRef } from 'react';
import { Search, ChevronDown, Check, Plus } from 'lucide-react';
import { rankOptions } from './searchableSelectMatch';

interface SearchableOption {
    value: string;
    label: string;
    subLabel?: string | number;
}

interface SearchableSelectProps {
    options: SearchableOption[];
    value: string;
    onChange: (value: string) => void;
    placeholder?: string;
    label?: React.ReactNode;
    onAddNew?: (term: string) => void;
    footerAction?: { label: string; onAction: () => void };
    disabled?: boolean;
    className?: string;
}

const SearchableSelect = ({ options, value, onChange, placeholder = "Select...", label, onAddNew, footerAction, disabled = false, className = '' }: SearchableSelectProps): React.ReactElement => {
    const [isOpen, setIsOpen] = useState(false);
    const [searchTerm, setSearchTerm] = useState('');
    const wrapperRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (wrapperRef.current && !wrapperRef.current.contains(event.target as Node)) {
                setIsOpen(false);
            }
        };
        document.addEventListener("mousedown", handleClickOutside);
        return () => document.removeEventListener("mousedown", handleClickOutside);
    }, [wrapperRef]);

    useEffect(() => {
        if (isOpen) {
            setSearchTerm('');
        }
    }, [isOpen]);

    const filteredOptions = rankOptions(options, searchTerm);

    const selectedOption = options.find(opt => opt.value === value);

    const handleSelect = (val: string): void => {
        onChange(val);
        setIsOpen(false);
        setSearchTerm('');
    };

    const handleAddNew = (): void => {
        if (onAddNew && searchTerm) {
            onAddNew(searchTerm);
            setIsOpen(false);
            setSearchTerm('');
        }
    };

    return (
        <div className={`mb-4 relative ${className}`} ref={wrapperRef}>
            {label && <label className="block mb-2 text-sm font-semibold text-neutral-700">{label}</label>}

            <div
                onClick={() => !disabled && setIsOpen(!isOpen)}
                className={`border rounded-md px-3 bg-neutral-0 flex justify-between items-center cursor-pointer min-h-10 transition-all duration-200 ${isOpen ? 'shadow-[0_0_0_2px_var(--color-primary-100)] border-primary-500' : 'border-neutral-300'} ${disabled ? 'opacity-60 cursor-not-allowed' : ''}`}
            >
                <span className={`text-[0.95rem] ${selectedOption ? 'text-neutral-800' : 'text-neutral-400'}`}>
                    {selectedOption ? selectedOption.label : placeholder}
                </span>
                <ChevronDown size={16} className="text-neutral-600" />
            </div>

            {isOpen && !disabled && (
                <div className="absolute top-full left-0 right-0 mt-1 bg-neutral-0 border border-neutral-300 rounded-md z-[100] shadow-lg">
                    <div className="p-2 border-b border-neutral-200">
                        <div className="relative flex items-center">
                            <Search size={14} className="absolute left-2 text-neutral-500" />
                            <input
                                type="text"
                                placeholder="Search..."
                                value={searchTerm}
                                onChange={(e) => setSearchTerm(e.target.value)}
                                autoFocus
                                className="w-full py-1.5 px-2 pl-7 border border-neutral-300 rounded text-[0.9rem] outline-none focus:border-primary-500"
                            />
                        </div>
                    </div>

                    <div className="max-h-[200px] overflow-y-auto">
                        {filteredOptions.length > 0 ? (
                            filteredOptions.map(opt => (
                                <div
                                    key={opt.value}
                                    onClick={() => handleSelect(opt.value)}
                                    className={`py-2 px-3 cursor-pointer text-[0.9rem] flex justify-between items-center hover:bg-neutral-50 ${selectedOption && selectedOption.value === opt.value ? 'bg-primary-50 text-primary-700' : ''}`}
                                >
                                    <div>
                                        <div className="font-medium">{opt.label}</div>
                                        {opt.subLabel && <div className="text-xs text-neutral-500">{opt.subLabel}</div>}
                                    </div>
                                    {selectedOption && selectedOption.value === opt.value && <Check size={14} className="text-primary-600" />}
                                </div>
                            ))
                        ) : (
                            <div className="p-1">
                                {onAddNew && searchTerm ? (
                                    <button
                                        onClick={handleAddNew}
                                        className="w-full p-2 border-none bg-primary-50 text-primary-700 cursor-pointer text-[0.9rem] rounded flex items-center justify-center gap-1.5 font-semibold hover:bg-primary-100"
                                    >
                                        <Plus size={14} /> Add new "{searchTerm}"
                                    </button>
                                ) : (
                                    <div className="p-3 text-center text-neutral-500 italic text-[0.9rem]">No results found</div>
                                )}
                            </div>
                        )}
                    </div>
                    {footerAction && (
                        <div className="border-t border-neutral-200">
                            <button
                                type="button"
                                onClick={() => { setIsOpen(false); footerAction.onAction(); }}
                                className="w-full px-3 py-2 text-left text-[0.85rem] text-primary-600 font-medium flex items-center gap-1.5 hover:bg-primary-50 transition-colors"
                            >
                                <Plus size={13} /> {footerAction.label}
                            </button>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
};

export default SearchableSelect;
