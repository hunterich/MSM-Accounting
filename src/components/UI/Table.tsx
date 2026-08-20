import React, { useMemo, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import RecordCount from './RecordCount';
import { TableSkeleton } from './LoadingSkeleton';

const AUTO_VIRTUALIZE_THRESHOLD = 50;

export interface TableColumn<T = Record<string, unknown>> {
    key: string;
    label: string;
    align?: 'left' | 'right' | 'center';
    sortable?: boolean;
    render?: (value: unknown, row: T) => React.ReactNode;
}

interface SortConfig {
    key: string;
    direction: 'ascending' | 'descending';
}

interface TableProps<T = Record<string, unknown>> {
    columns: TableColumn<T>[];
    data: T[];
    onRowClick?: (row: T) => void;
    className?: string;
    virtualize?: boolean | 'auto';
    maxHeight?: number | string;
    rowHeight?: number;
    showCount?: boolean;
    countLabel?: string;
    isLoading?: boolean;
    loadingLabel?: string;
    loadingRowCount?: number;
}

const Table = <T extends Record<string, unknown>>({
    columns,
    data,
    onRowClick,
    className = '',
    virtualize = 'auto',
    maxHeight = 600,
    rowHeight = 28,
    showCount = false,
    countLabel = 'records',
    isLoading = false,
    loadingLabel = 'Loading records...',
    loadingRowCount = 6
}: TableProps<T>): React.ReactElement => {
    const [sortConfig, setSortConfig] = useState<SortConfig | null>(null);
    const scrollElementRef = useRef<HTMLDivElement>(null);

    const rows = Array.isArray(data) ? data : [];

    const sortedData = useMemo(() => {
        const sortableItems = [...rows];
        if (sortConfig !== null) {
            sortableItems.sort((a, b) => {
                const aVal = a[sortConfig.key] as string | number | null | undefined;
                const bVal = b[sortConfig.key] as string | number | null | undefined;
                if ((aVal ?? '') < (bVal ?? '')) {
                    return sortConfig.direction === 'ascending' ? -1 : 1;
                }
                if ((aVal ?? '') > (bVal ?? '')) {
                    return sortConfig.direction === 'ascending' ? 1 : -1;
                }
                return 0;
            });
        }
        return sortableItems;
    }, [rows, sortConfig]);

    const shouldVirtualize = useMemo(() => {
        if (virtualize === true) return true;
        if (virtualize === false) return false;
        return sortedData.length > AUTO_VIRTUALIZE_THRESHOLD;
    }, [virtualize, sortedData.length]);

    const rowVirtualizer = useVirtualizer({
        count: shouldVirtualize ? sortedData.length : 0,
        getScrollElement: () => scrollElementRef.current,
        estimateSize: () => rowHeight,
        overscan: 8,
    });

    const requestSort = (key: string): void => {
        let direction: 'ascending' | 'descending' = 'ascending';
        if (sortConfig && sortConfig.key === key && sortConfig.direction === 'ascending') {
            direction = 'descending';
        }
        setSortConfig({ key, direction });
    };

    const renderColGroup = (): React.ReactElement => {
        const width = `${100 / Math.max(columns.length, 1)}%`;
        return (
            <colgroup>
                {columns.map((_, index) => (
                    <col key={index} style={{ width }} />
                ))}
            </colgroup>
        );
    };

    const renderHeaderCells = (): React.ReactElement => (
        <tr>
            {columns.map((col, index) => (
                <th
                    key={index}
                    className={col.sortable ? 'sortable' : ''}
                    onClick={() => (col.sortable ? requestSort(col.key) : null)}
                >
                    {col.sortable && (
                        <span className="acc-grid-sort">
                            {sortConfig?.key === col.key ? (sortConfig.direction === 'ascending' ? '▲' : '▼') : '⇅'}
                        </span>
                    )}
                    {col.label}
                </th>
            ))}
        </tr>
    );

    const renderRow = (row: T, rowKey: string, rowIndex: number, style: React.CSSProperties | null = null, measureRef: ((node: Element | null) => void) | null = null, rowClassName = ''): React.ReactElement => (
        <tr
            key={rowKey}
            data-index={rowIndex}
            ref={measureRef}
            style={style || undefined}
            onClick={() => onRowClick && onRowClick(row)}
            className={`${onRowClick ? 'cursor-pointer' : ''} ${rowClassName}`}
        >
            {columns.map((col, colIndex) => (
                <td key={colIndex} className={col.align === 'right' ? 'text-right' : col.align === 'center' ? 'text-center' : ''}>
                    {col.render ? col.render(row?.[col.key], row) : (row?.[col.key] as React.ReactNode)}
                </td>
            ))}
        </tr>
    );

    if (isLoading) {
        return (
            <TableSkeleton
                columnCount={columns.length}
                rowCount={loadingRowCount}
                showCount={showCount}
                className={className}
                label={loadingLabel}
            />
        );
    }

    if (sortedData.length === 0) {
        return (
            <div className={`acc-grid-wrap ${className}`}>
                <div className="p-4 text-center text-neutral-600">No data available</div>
                {showCount ? <RecordCount count={0} label={countLabel} /> : null}
            </div>
        );
    }

    if (!shouldVirtualize) {
        return (
            <div className={`acc-grid-wrap ${className}`}>
                <div className="w-full overflow-x-auto">
                    <table className="acc-grid">
                        <thead>
                            {renderHeaderCells()}
                        </thead>
                        <tbody>
                            {sortedData.map((row, rowIndex) =>
                                renderRow(
                                    row,
                                    `row-${rowIndex}`,
                                    rowIndex,
                                    null,
                                    null,
                                    rowIndex === sortedData.length - 1 ? 'last:[&_td]:border-b-0' : ''
                                )
                            )}
                        </tbody>
                    </table>
                </div>
                {showCount ? <RecordCount count={sortedData.length} label={countLabel} /> : null}
            </div>
        );
    }

    const virtualRows = rowVirtualizer.getVirtualItems();

    return (
        <div className={`acc-grid-wrap ${className}`}>
                <div className="w-full overflow-x-auto">
                    <table className="acc-grid table-fixed">
                        {renderColGroup()}
                        <thead>
                            {renderHeaderCells()}
                        </thead>
                    </table>
                </div>

            <div
                ref={scrollElementRef}
                className="table-virtual-scroll"
                style={{ maxHeight: typeof maxHeight === 'number' ? `${maxHeight}px` : maxHeight }}
            >
                <div
                    className="table-virtual-inner"
                    style={{ height: `${rowVirtualizer.getTotalSize()}px`, position: 'relative' }}
                >
                    {virtualRows.map((virtualRow) => {
                        const row = sortedData[virtualRow.index];
                        if (!row) return null;

                        return (
                            <table
                                key={`virtual-row-${virtualRow.index}`}
                                data-index={virtualRow.index}
                                ref={(node) => {
                                    if (node) rowVirtualizer.measureElement(node);
                                }}
                                className="table-virtual-row acc-grid table-fixed"
                                style={{
                                    top: 0,
                                    transform: `translateY(${virtualRow.start}px)`,
                                }}
                            >
                                {renderColGroup()}
                                <tbody>
                                    <tr
                                        onClick={() => onRowClick && onRowClick(row)}
                                        className={`${onRowClick ? 'cursor-pointer' : ''} hover:bg-neutral-50`}
                                    >
                                        {columns.map((col, colIndex) => (
                                            <td key={colIndex} className={`py-3 px-4 text-neutral-900 border-b border-neutral-200 ${col.align === 'right' ? 'text-right' : col.align === 'center' ? 'text-center' : ''}`}>
                                                {col.render ? col.render(row?.[col.key], row) : (row?.[col.key] as React.ReactNode)}
                                            </td>
                                        ))}
                                    </tr>
                                </tbody>
                            </table>
                        );
                    })}
                </div>
            </div>

            {showCount ? <RecordCount count={sortedData.length} label={countLabel} /> : null}
        </div>
    );
};

export default Table;
