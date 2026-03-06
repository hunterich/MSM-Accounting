import React from 'react';
import { formatDateID, formatIDR } from '../../utils/formatters';

const ReportPrintTemplate = ({
    title,
    dateRangeLabel,
    columns,
    data,
    company,
    totals = null
}) => {
    return (
        <div className="print-report-wrapper w-full p-8 text-neutral-800 bg-white">
            {/* Header */}
            <div className="flex justify-between items-start border-b border-neutral-300 pb-6 mb-6">
                <div>
                    <h1 className="text-2xl font-bold text-slate-900 mb-1">{company?.name || 'Company Name'}</h1>
                    <div className="text-sm text-neutral-600 space-y-0.5">
                        <p>{company?.address || 'Company Address'}</p>
                        <p>{company?.phone && `Phone: ${company.phone}`} {company?.email && `| Email: ${company.email}`}</p>
                        {company?.npwp && <p>NPWP: {company.npwp}</p>}
                    </div>
                </div>
                <div className="text-right">
                    <h2 className="text-xl font-bold text-primary-700 uppercase tracking-wider">{title}</h2>
                    {dateRangeLabel && <p className="text-sm text-neutral-600 mt-1">{dateRangeLabel}</p>}
                    <p className="text-xs text-neutral-500 mt-2">Printed: {formatDateID(new Date().toISOString().split('T')[0])}</p>
                </div>
            </div>

            {/* Table */}
            <div className="mt-6">
                <table className="w-full text-sm text-left font-medium border-collapse">
                    <thead>
                        <tr className="border-b-2 border-slate-800 text-slate-700">
                            {columns.map((col, idx) => (
                                <th
                                    key={col.key || idx}
                                    className={`py-3 px-2 font-bold ${col.align === 'right' ? 'text-right' : 'text-left'}`}
                                >
                                    {col.label}
                                </th>
                            ))}
                        </tr>
                    </thead>
                    <tbody>
                        {data.length > 0 ? data.map((row, rIdx) => {
                            const isSubtotal = row.isSubtotal;
                            return (
                                <tr
                                    key={rIdx}
                                    className={`border-b border-neutral-200 ${isSubtotal ? 'bg-neutral-50 font-bold' : ''}`}
                                >
                                    {columns.map((col, cIdx) => {
                                        let val = row[col.key];
                                        if (col.render) {
                                            // Handle cases where render might return JSX.
                                            // For print template, we ideally want the string value or a simple representation
                                            try {
                                                const rendered = col.render(val, row);
                                                if (typeof rendered === 'string' || typeof rendered === 'number') {
                                                    val = rendered;
                                                } else if (rendered && rendered.props && rendered.props.children) {
                                                    val = rendered.props.children;
                                                }
                                            } catch (e) {
                                                val = row[col.key];
                                            }
                                        }

                                        // Fallback formatting for subtotal rows that might not be handled by generic render logic
                                        if (isSubtotal && (col.key === 'account' || col.key === 'description')) {
                                            val = `Subtotal ${row.subGroup || ''}`;
                                        }

                                        return (
                                            <td
                                                key={cIdx}
                                                className={`py-2 px-2 ${col.align === 'right' ? 'text-right' : 'text-left'} ${isSubtotal ? 'text-slate-900' : 'text-neutral-700'}`}
                                            >
                                                {val}
                                            </td>
                                        );
                                    })}
                                </tr>
                            );
                        }) : (
                            <tr>
                                <td colSpan={columns.length} className="py-4 text-center text-neutral-500 italic">
                                    No records found.
                                </td>
                            </tr>
                        )}
                    </tbody>
                </table>
            </div>

            {/* Optional Totals Footer */}
            {totals && (
                <div className="mt-8 pt-4 border-t-2 border-slate-800 flex justify-end">
                    <div className="space-y-2 text-sm text-right">
                        {totals.map((t, idx) => (
                            <div key={idx} className="flex gap-8 justify-end">
                                <span className="font-semibold text-neutral-600">{t.label}:</span>
                                <span className="font-bold text-slate-900 w-32">{t.value}</span>
                            </div>
                        ))}
                    </div>
                </div>
            )}

        </div>
    );
};

export default ReportPrintTemplate;
