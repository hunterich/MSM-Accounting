import React from 'react';
import { Search } from 'lucide-react';

interface FilterOption {
    value: string;
    label: string;
}

interface Filter {
    key: string;
    label: string;
    options: FilterOption[];
}

interface FilterBarProps {
    onSearch: (value: string) => void;
    filters?: Filter[];
    activeFilters: Record<string, string>;
    onFilterChange: (key: string, value: string) => void;
    placeholder?: string;
    /** Extra controls (e.g. a date range) rendered as further chips in the row. */
    extra?: React.ReactNode;
}

/**
 * Accurate-style filter row: each filter is a compact "Label: value" chip that
 * highlights once it is narrowed from the default, with the search field
 * pushed to the right of the row rather than sitting in a panel above it.
 */
const FilterBar = ({
    onSearch,
    filters = [],
    activeFilters,
    onFilterChange,
    placeholder = 'Type and press Enter',
    extra = null,
}: FilterBarProps): React.ReactElement => {
    return (
        <div className="acc-toolbar-row mb-2">
            {filters.map((filter) => {
                const value = activeFilters[filter.key] || '';
                const selected = filter.options.find((o) => o.value === value);
                return (
                    <label key={filter.key} className={`acc-chip ${value ? 'on' : ''}`}>
                        <span className="acc-chip-label">{filter.label}:</span>
                        <select
                            className="cursor-pointer border-none bg-transparent p-0 text-[0.72rem] text-inherit outline-none"
                            value={value}
                            onChange={(e) => onFilterChange(filter.key, e.target.value)}
                            aria-label={filter.label}
                        >
                            <option value="">All</option>
                            {filter.options.map((opt) => (
                                <option key={opt.value} value={opt.value}>{opt.label}</option>
                            ))}
                        </select>
                        <span className="sr-only">{selected?.label ?? 'All'}</span>
                    </label>
                );
            })}

            {extra}

            <div className="spacer" />

            <div className="acc-search">
                <input
                    type="text"
                    placeholder={placeholder}
                    onChange={(e) => onSearch(e.target.value)}
                    aria-label="Search"
                />
                <Search size={13} />
            </div>
        </div>
    );
};

export default FilterBar;
