import React from 'react';
import { useInvoice, useSendInvoiceEmail } from '../../../hooks/useAR';
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
    const sendEmail = useSendInvoiceEmail();

    const status = String(invoice?.status ?? '').toLowerCase();
    const disabledReason =
        status === 'void' ? 'A voided invoice cannot be emailed'
        : status === 'pending_approval' || status === 'pending approval' ? 'This invoice is awaiting approval'
        : status === 'draft' ? 'Finalize this invoice before emailing it to the customer'
        : undefined;
    const emailAction = invoice ? {
        defaultTo: invoice.email || invoice.customerEmail || '',
        disabledReason,
        send: async ({ to, cc, message, pdfBase64, pdfName }: { to: string; cc: string; message: string; pdfBase64: string; pdfName: string }) => {
            await sendEmail.mutateAsync({
                invoiceId: invoice.id,
                to,
                cc: cc || undefined,
                message: message || undefined,
                pdfBase64,
                pdfName,
            });
        },
    } : undefined;

    return (
        <PrintPreviewModal
            isOpen={Boolean(invoiceId)}
            onClose={onClose}
            title="Invoice Print Preview"
            documentTitle={`Invoice_${invoice?.number || invoiceId || ''}`}
            defaultPaperSize={printSettings.defaultPaperSize}
            emailAction={emailAction}
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
