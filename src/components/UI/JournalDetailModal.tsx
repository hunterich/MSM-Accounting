import React from 'react';
import Modal from './Modal';
import { formatIDR } from '../../utils/formatters';
import type { JournalDetail } from '../../hooks/useAP';

type Props = {
    isOpen: boolean;
    onClose: () => void;
    journal: JournalDetail | null | undefined;
    isLoading?: boolean;
    /** Header context shown above the lines (vendor/branch/etc.). */
    meta?: Array<{ label: string; value: React.ReactNode }>;
    title?: string;
};

/**
 * "Rincian Jurnal" — shows the GL posting (Dr/Cr) for a saved document,
 * mirroring Accurate's journal-detail popup.
 */
const JournalDetailModal = ({ isOpen, onClose, journal, isLoading, meta = [], title = 'Rincian Jurnal' }: Props): React.ReactElement => {
    return (
        <Modal isOpen={isOpen} onClose={onClose} title={title} size="lg">
            {isLoading ? (
                <div className="p-6 text-center text-neutral-400">Loading journal…</div>
            ) : !journal ? (
                <div className="p-6 text-center text-neutral-400">
                    No journal entry yet — this document hasn’t been posted to the ledger.
                </div>
            ) : (
                <div className="flex flex-col gap-4">
                    <div className="grid grid-cols-2 gap-x-8 gap-y-1 text-sm">
                        <div className="flex justify-between"><span className="text-neutral-500">Tanggal</span><span className="text-neutral-800">{String(journal.date).slice(0, 10)}</span></div>
                        <div className="flex justify-between"><span className="text-neutral-500">Nomor #</span><span className="text-primary-700 font-medium">{journal.entryNo}</span></div>
                        {meta.map((m) => (
                            <div key={m.label} className="flex justify-between"><span className="text-neutral-500">{m.label}</span><span className="text-neutral-800">{m.value}</span></div>
                        ))}
                        {journal.memo ? (
                            <div className="flex justify-between col-span-2"><span className="text-neutral-500">Keterangan</span><span className="text-neutral-800">{journal.memo}</span></div>
                        ) : null}
                    </div>

                    <table className="w-full border-collapse text-sm">
                        <thead>
                            <tr>
                                <th className="text-left p-2 border-y border-neutral-200 font-semibold text-neutral-600">Akun Perkiraan</th>
                                <th className="text-right p-2 border-y border-neutral-200 font-semibold text-neutral-600 w-[22%]">Debit</th>
                                <th className="text-right p-2 border-y border-neutral-200 font-semibold text-neutral-600 w-[22%]">Kredit</th>
                            </tr>
                        </thead>
                        <tbody>
                            {journal.lines.map((l) => (
                                <tr key={l.lineNo} className="border-b border-neutral-100">
                                    <td className="p-2">
                                        <div className={`text-neutral-800 ${l.credit > 0 && l.debit === 0 ? 'pl-6' : ''}`}>{l.accountCode} {l.accountName}</div>
                                        {l.description ? <div className="text-xs text-neutral-400">{l.description}</div> : null}
                                    </td>
                                    <td className="p-2 text-right text-neutral-800">{l.debit ? formatIDR(l.debit) : ''}</td>
                                    <td className="p-2 text-right text-neutral-800">{l.credit ? formatIDR(l.credit) : ''}</td>
                                </tr>
                            ))}
                        </tbody>
                        <tfoot>
                            <tr className="font-semibold">
                                <td className="p-2 text-right text-neutral-500">Total</td>
                                <td className="p-2 text-right text-neutral-900 border-t border-neutral-300">{formatIDR(journal.totalDebit)}</td>
                                <td className="p-2 text-right text-neutral-900 border-t border-neutral-300">{formatIDR(journal.totalCredit)}</td>
                            </tr>
                        </tfoot>
                    </table>
                </div>
            )}
        </Modal>
    );
};

export default JournalDetailModal;
