import React from 'react';
import { Search } from 'lucide-react';

const FilterBar = ({ onSearch, filters = [], activeFilters, onFilterChange, placeholder = "Search..." }) => {
    return (
        <div className="flex gap-3 items-end bg-neutral-0 border border-neutral-200 p-3 rounded-lg mb-4">
            <div className="flex-1 relative flex items-center gap-2 text-neutral-500">
                <Search size={18} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-neutral-400 pointer-events-none" />
                <input
                    type="text"
                    className="block w-full pl-9 px-3 text-base leading-normal text-neutral-900 bg-neutral-0 border border-neutral-300 rounded-md min-h-10 transition-[border-color,box-shadow] duration-150 focus:border-primary-500 focus:outline-0 focus:shadow-[0_0_0_3px_var(--color-primary-100)]"
                    placeholder={placeholder}
                    onChange={(e) => onSearch(e.target.value)}
                />
            </div>

            {filters.map(filter => (
                <div key={filter.key} className="min-w-[160px]">
                    <select
                        className="block w-full px-3 text-base leading-normal text-neutral-900 bg-neutral-0 border border-neutral-300 rounded-md min-h-10 transition-[border-color,box-shadow] duration-150 focus:border-primary-500 focus:outline-0 focus:shadow-[0_0_0_3px_var(--color-primary-100)]"
                        value={activeFilters[filter.key] || ''}
                        onChange={(e) => onFilterChange(filter.key, e.target.value)}
                    >
                        <option value="">{filter.label}</option>
                        {filter.options.map(opt => (
                            <option key={opt.value} value={opt.value}>{opt.label}</option>
                        ))}
                    </select>
                </div>
            ))}
        </div>
    );
};

export default FilterBar;
