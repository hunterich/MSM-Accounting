import React from 'react';
import { formatIDR } from '../../../utils/formatters';

interface AuditEntry {
    id: string;
    action?: string;
    date?: string;
    user?: string;
    [key: string]: unknown;
}

interface JournalLine {
    id: string;
    account?: string;
    dr?: number | string;
    cr?: number | string;
    [key: string]: unknown;
}

interface InvoiceRecord {
    audit?: AuditEntry[];
    journal?: JournalLine[];
    [key: string]: unknown;
}

interface InvoiceAuditJournalTabProps {
    invoice: InvoiceRecord;
}

const InvoiceAuditJournalTab: React.FC<InvoiceAuditJournalTabProps> = ({ invoice }) => {
    const audit = invoice.audit || [];
    const journal = invoice.journal || [];

    return (
        <div className="audit-journal-grid">
            <div>
                <h4>Audit Timeline</h4>
                {audit.length === 0 ? (
                    <div className="text-neutral-600 text-[0.9rem]">No audit history yet.</div>
                ) : (
                    <ul className="audit-list">
                        {audit.map((entry) => (
                            <li key={entry.id}>
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
                    <table className="invoice-workbench-table">
                        <thead>
                            <tr>
                                <th>Account</th>
                                <th className="text-right">DR</th>
                                <th className="text-right">CR</th>
                            </tr>
                        </thead>
                        <tbody>
                            {journal.map((line) => (
                                <tr key={line.id}>
                                    <td>{line.account}</td>
                                    <td className="text-right">{line.dr ? formatIDR(line.dr) : '-'}</td>
                                    <td className="text-right">{line.cr ? formatIDR(line.cr) : '-'}</td>
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
