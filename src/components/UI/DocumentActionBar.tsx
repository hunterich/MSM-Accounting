import React, { useState } from 'react';
import { Printer, History, Trash2 } from 'lucide-react';
import Button from './Button';
import Modal from './Modal';
import AuditLogPanel from './AuditLogPanel';
import { resolveActionBarState } from './documentActionState';

export type DocumentEntityType = 'PurchaseOrder' | 'Bill' | 'SalesInvoice' | 'SalesOrder';

interface DocumentActionBarProps {
    /** Entity type as recorded by logAudit, used for the History panel. */
    entityType: DocumentEntityType;
    /** undefined while the document is new/unsaved — disables Print/History/Delete. */
    entityId?: string;
    isSaving?: boolean;
    canSave?: boolean;
    saveLabel?: string;
    /** Omit (e.g. read-only view mode) to hide the Save button. */
    onSave?: () => void;
    onSaveDraft?: () => void;
    /** Extra buttons (e.g. Approve / Pay in view mode) rendered before Save. */
    extraActions?: React.ReactNode;
    /** Omit to hide the Print button; triggers the host form's print flow. */
    onPrint?: () => void;
    /** Omit to hide Delete; called after the user confirms. */
    onDelete?: () => void;
    /** Document is in a deletable state (e.g. DRAFT). */
    canDelete?: boolean;
}

/**
 * Reusable document toolbar: Print, History, Delete, Save Draft, Save.
 * Presentational — host forms own Save/Print/Delete via callbacks. The bar owns
 * only the History modal (reusing AuditLogPanel) and the Delete confirmation.
 * Render it as the `actions` of a sticky FormPage/PageHeader.
 */
const DocumentActionBar = ({
    entityType,
    entityId,
    isSaving = false,
    canSave = true,
    saveLabel = 'Save',
    onSave,
    onSaveDraft,
    extraActions,
    onPrint,
    onDelete,
    canDelete = false,
}: DocumentActionBarProps): React.ReactElement => {
    const [historyOpen, setHistoryOpen] = useState(false);
    const [confirmDelete, setConfirmDelete] = useState(false);

    const st = resolveActionBarState({
        entityId,
        canSave,
        canDelete,
        hasPrint: Boolean(onPrint),
        hasSaveDraft: Boolean(onSaveDraft),
        hasDelete: Boolean(onDelete),
    });
    const hasRightCluster = Boolean(extraActions) || st.showSaveDraft || Boolean(onSave);

    return (
        <>
            <div className="flex gap-2 items-center flex-wrap justify-end">
                {st.showPrint && (
                    <Button variant="secondary" size="md" icon={<Printer size={15} />} text="Print"
                        disabled={!st.printEnabled} onClick={onPrint} />
                )}
                <Button variant="secondary" size="md" icon={<History size={15} />} text="History"
                    disabled={!st.historyEnabled} onClick={() => setHistoryOpen(true)} />
                {st.showDelete && (
                    <Button variant="danger" size="md" icon={<Trash2 size={15} />} text="Delete"
                        disabled={!st.deleteEnabled} onClick={() => setConfirmDelete(true)} />
                )}
                {hasRightCluster && <span className="w-px h-6 bg-neutral-200 mx-1" aria-hidden />}
                {extraActions}
                {st.showSaveDraft && (
                    <Button variant="secondary" size="md" text="Save Draft" disabled={isSaving} onClick={onSaveDraft} />
                )}
                {onSave && (
                    <Button variant="primary" size="md" text={saveLabel} loading={isSaving} disabled={!st.saveEnabled} onClick={onSave} />
                )}
            </div>

            <Modal isOpen={historyOpen} onClose={() => setHistoryOpen(false)} title="History" size="lg">
                <AuditLogPanel entityType={entityType} entityId={entityId} />
            </Modal>

            <Modal isOpen={confirmDelete} onClose={() => setConfirmDelete(false)} title="Delete document" size="sm">
                <p className="text-sm text-neutral-700 mb-5">
                    This document will be deleted. This action cannot be undone.
                </p>
                <div className="flex justify-end gap-2">
                    <Button variant="secondary" text="Cancel" onClick={() => setConfirmDelete(false)} />
                    <Button variant="dangerSolid" text="Delete" onClick={() => { setConfirmDelete(false); onDelete?.(); }} />
                </div>
            </Modal>
        </>
    );
};

export default DocumentActionBar;
