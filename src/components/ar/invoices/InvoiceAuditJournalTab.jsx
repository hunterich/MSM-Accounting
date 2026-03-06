import React from 'react';
import { formatIDR } from '../../../utils/formatters';

const InvoiceAuditJournalTab = ({ invoice }) => {
    const audit = invoice.audit || [];
    const journal = invoice.journal || [];

    return (
        <div className="grid grid-cols-2 gap-3">
            <div>
                <h4>Audit Timeline</h4>
                {audit.length === 0 ? (
                    <div className="text-neutral-600 text-[0.9rem]">No audit history yet.</div>
                ) : (
                    <ul className="list-none m-0 p-0">
                        {audit.map((entry) => (
                            <li key={entry.id} className="border border-neutral-200 rounded-lg py-2 px-2.5 mb-2 text-[0.88rem]">
                                <div><strong>{entry.action}</strong></div>
                                <div>{entry.date} • {entry.user}</div>
                            </li>
                        ))}
                    </ul>
                )}
            </div>
            <div>
                <h4>Journal Preview</h4>
                {journal.length === 0 ? (
                    <div className="text-neutral-600 text-[0.9rem]">No journal entries (draft).</div>
                ) : (
                    <table className="w-full border-collapse text-[0.9rem]">
                        <thead>
                            <tr>
                                <th className="py-[9px] px-2.5 text-left font-semibold text-neutral-700 border-b border-neutral-200 bg-neutral-100 sticky top-0 z-[1]">Account</th>
                                <th className="py-[9px] px-2.5 text-right font-semibold text-neutral-700 border-b border-neutral-200 bg-neutral-100 sticky top-0 z-[1]">DR</th>
                                <th className="py-[9px] px-2.5 text-right font-semibold text-neutral-700 border-b border-neutral-200 bg-neutral-100 sticky top-0 z-[1]">CR</th>
                            </tr>
                        </thead>
                        <tbody>
                            {journal.map((line) => (
                                <tr key={line.id}>
                                    <td className="py-[9px] px-2.5 border-b border-neutral-200">{line.account}</td>
                                    <td className="py-[9px] px-2.5 border-b border-neutral-200 text-right">{line.dr ? formatIDR(line.dr) : '-'}</td>
                                    <td className="py-[9px] px-2.5 border-b border-neutral-200 text-right">{line.cr ? formatIDR(line.cr) : '-'}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                )}
            </div>
        </div>
    );
};

export default InvoiceAuditJournalTab;
