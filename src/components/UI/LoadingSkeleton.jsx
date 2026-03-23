import React from 'react';

const skeletonClassName = 'skeleton-block';

export const SkeletonBlock = ({ className = '' }) => (
    <div className={`${skeletonClassName} ${className}`.trim()} aria-hidden="true" />
);

export const TableSkeleton = ({
    columnCount = 5,
    rowCount = 6,
    showCount = false,
    className = '',
    label = 'Loading records...'
}) => {
    const columns = Math.max(columnCount, 1);
    const rows = Math.max(rowCount, 1);

    return (
        <div className={`w-full rounded-lg border border-neutral-200 bg-neutral-0 overflow-hidden ${className}`}>
            <div className="px-4 py-3 border-b border-neutral-200 bg-neutral-50 text-sm text-neutral-500" role="status" aria-live="polite">
                {label}
            </div>
            <div className="w-full overflow-x-auto">
                <table className="w-full border-collapse text-sm bg-neutral-0">
                    <thead>
                        <tr>
                            {Array.from({ length: columns }).map((_, index) => (
                                <th key={`skeleton-head-${index}`} className="bg-neutral-100 py-3 px-4 border-b border-neutral-200">
                                    <SkeletonBlock className="h-4 w-20 max-w-full" />
                                </th>
                            ))}
                        </tr>
                    </thead>
                    <tbody>
                        {Array.from({ length: rows }).map((_, rowIndex) => (
                            <tr key={`skeleton-row-${rowIndex}`}>
                                {Array.from({ length: columns }).map((__, columnIndex) => (
                                    <td key={`skeleton-cell-${rowIndex}-${columnIndex}`} className="py-3 px-4 border-b border-neutral-200 last:border-b-neutral-200">
                                        <SkeletonBlock
                                            className={`h-4 ${columnIndex === columns - 1 ? 'w-16 ml-auto' : columnIndex === 0 ? 'w-24' : 'w-full max-w-[180px]'}`}
                                        />
                                    </td>
                                ))}
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
            {showCount ? (
                <div className="px-4 py-3 border-t border-neutral-200 bg-neutral-50">
                    <SkeletonBlock className="h-4 w-24" />
                </div>
            ) : null}
        </div>
    );
};

export const FormSkeleton = ({ className = '' }) => (
    <div className={`space-y-4 ${className}`}>
        <div className="bg-neutral-0 border border-neutral-200 rounded-lg p-5 border-t-3 border-t-primary-500">
            <div className="grid grid-cols-12 gap-4">
                <div className="col-span-4 space-y-2">
                    <SkeletonBlock className="h-4 w-24" />
                    <SkeletonBlock className="h-10 w-full rounded-md" />
                </div>
                <div className="col-span-2 space-y-2">
                    <SkeletonBlock className="h-4 w-16" />
                    <SkeletonBlock className="h-10 w-full rounded-md" />
                </div>
                <div className="col-span-3 space-y-2">
                    <SkeletonBlock className="h-4 w-20" />
                    <SkeletonBlock className="h-10 w-full rounded-md" />
                </div>
                <div className="col-span-3 space-y-2">
                    <SkeletonBlock className="h-4 w-20" />
                    <SkeletonBlock className="h-10 w-full rounded-md" />
                </div>
                <div className="col-span-12">
                    <SkeletonBlock className="h-px w-full rounded-none" />
                </div>
                <div className="col-span-6 space-y-2">
                    <SkeletonBlock className="h-4 w-28" />
                    <SkeletonBlock className="h-10 w-full rounded-md" />
                </div>
                <div className="col-span-6 space-y-2">
                    <SkeletonBlock className="h-4 w-28" />
                    <SkeletonBlock className="h-10 w-full rounded-md" />
                </div>
                <div className="col-span-12 space-y-2">
                    <SkeletonBlock className="h-4 w-32" />
                    <SkeletonBlock className="h-28 w-full rounded-md" />
                </div>
            </div>
        </div>

        <div className="bg-neutral-0 border border-neutral-200 rounded-lg p-5">
            <div className="grid grid-cols-12 gap-4">
                <div className="col-span-12 flex items-center justify-between">
                    <SkeletonBlock className="h-5 w-40" />
                    <SkeletonBlock className="h-9 w-28 rounded-md" />
                </div>
                <div className="col-span-12">
                    <SkeletonBlock className="h-48 w-full rounded-md" />
                </div>
            </div>
        </div>
    </div>
);
