import React from 'react';
import { useInvoice } from '../../../hooks/useAR';
import { useSettingsStore } from '../../../stores/useSettingsStore';
import PrintPreviewModal from '../../UI/PrintPreviewModal';
import InvoicePrintTemplate from '../../print/InvoicePrintTemplate';

interface Props {
    invoiceId: string | null;
    onClose: () => void;
}

/** Load the saved document for printing, independent of the edit form. */
const InvoicePrintPreview: React.FC<Props> = ({ invoiceId, onClose }) => {
    const { data: invoice, isLoading, error } = useInvoice(invoiceId ?? undefined);
    const company = useSettingsStore((state) => state.companyInfo);
    const printSettings = useSettingsStore((state) => state.printSettings);

    return (
        <PrintPreviewModal
            isOpen={Boolean(invoiceId)}
            onClose={onClose}
            title="Invoice Print Preview"
            documentTitle={`Invoice_${invoice?.number || invoiceId || ''}`}
            defaultPaperSize={printSettings.defaultPaperSize}
        >
            {invoice ? (
                <InvoicePrintTemplate
                    invoice={invoice}
                    lineItems={invoice.lines}
                    company={company}
                    options={printSettings}
                />
            ) : (
                <div className="p-6 text-sm text-neutral-600">
                    {error ? `Could not load invoice: ${error.message}` : isLoading ? 'Loading invoice...' : 'Invoice not found.'}
                </div>
            )}
        </PrintPreviewModal>
    );
};

export default InvoicePrintPreview;
