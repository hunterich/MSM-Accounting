import React, { useEffect, useState } from 'react';
import { Mail } from 'lucide-react';
import Modal from './Modal';
import Button from './Button';

export interface EmailDocumentValues {
    to: string;
    cc: string;
    message: string;
}

interface EmailDocumentDialogProps {
    isOpen: boolean;
    onClose: () => void;
    defaultTo: string;
    /** What is being sent, shown above the form, e.g. the attachment file name. */
    attachmentLabel?: string;
    /** Caution shown above the form (e.g. "sending will finalize this draft"). */
    warning?: string;
    sending: boolean;
    error: string | null;
    onSubmit: (values: EmailDocumentValues) => void;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const inputCls = 'block w-full px-3 text-sm leading-normal bg-neutral-0 border border-neutral-300 rounded-md h-10 focus:border-primary-500 focus:outline-0';

/** Recipient / CC / note form for emailing a document with its PDF attached. */
const EmailDocumentDialog: React.FC<EmailDocumentDialogProps> = ({
    isOpen, onClose, defaultTo, attachmentLabel, warning, sending, error, onSubmit,
}) => {
    const [to, setTo] = useState(defaultTo);
    const [cc, setCc] = useState('');
    const [message, setMessage] = useState('');
    const [touched, setTouched] = useState(false);

    // Start fresh each time the dialog opens, defaulting to the customer's address.
    useEffect(() => {
        if (isOpen) { setTo(defaultTo); setCc(''); setMessage(''); setTouched(false); }
    }, [isOpen, defaultTo]);

    const toValid = EMAIL_RE.test(to.trim());
    const ccValid = cc.trim() === '' || EMAIL_RE.test(cc.trim());

    const submit = () => {
        setTouched(true);
        if (!toValid || !ccValid || sending) return;
        onSubmit({ to: to.trim(), cc: cc.trim(), message: message.trim() });
    };

    return (
        <Modal isOpen={isOpen} onClose={sending ? () => {} : onClose} title="Send by email" size="md">
            <div className="space-y-4">
                {attachmentLabel && (
                    <div className="text-sm text-neutral-600">
                        Attaches <span className="font-medium text-neutral-800">{attachmentLabel}</span> as a PDF.
                    </div>
                )}
                {warning && (
                    <div className="bg-warning-50 border border-warning-200 rounded-md px-3 py-2 text-[13px] text-warning-800">
                        {warning}
                    </div>
                )}
                <div>
                    <label className="block text-sm text-neutral-600 mb-1" htmlFor="email-to">To</label>
                    <input id="email-to" type="email" value={to} onChange={(e) => setTo(e.target.value)}
                        placeholder="customer@example.com" className={inputCls} autoFocus />
                    {touched && !toValid && <div className="text-xs text-danger-600 mt-1">Enter a valid email address.</div>}
                </div>
                <div>
                    <label className="block text-sm text-neutral-600 mb-1" htmlFor="email-cc">CC <span className="text-neutral-400">(optional)</span></label>
                    <input id="email-cc" type="email" value={cc} onChange={(e) => setCc(e.target.value)} className={inputCls} />
                    {touched && !ccValid && <div className="text-xs text-danger-600 mt-1">Enter a valid email address.</div>}
                </div>
                <div>
                    <label className="block text-sm text-neutral-600 mb-1" htmlFor="email-note">Note <span className="text-neutral-400">(optional)</span></label>
                    <textarea id="email-note" value={message} onChange={(e) => setMessage(e.target.value)} maxLength={2000} rows={4}
                        placeholder="Added above the standard invoice message."
                        className="block w-full px-3 py-2 text-sm bg-neutral-0 border border-neutral-300 rounded-md focus:border-primary-500 focus:outline-0" />
                </div>
                {error && <div className="text-sm text-danger-600" role="alert">{error}</div>}
                <div className="flex justify-end gap-2 pt-2 border-t border-neutral-200">
                    <Button text="Cancel" variant="secondary" onClick={onClose} disabled={sending} />
                    <Button text={sending ? 'Sending…' : 'Send'} variant="primary" icon={<Mail size={16} />} onClick={submit} disabled={sending} />
                </div>
            </div>
        </Modal>
    );
};

export default EmailDocumentDialog;
