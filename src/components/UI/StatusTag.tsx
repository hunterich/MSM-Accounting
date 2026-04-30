import React from 'react';

type Tone = 'success' | 'danger' | 'warning' | 'info' | 'neutral';

interface StatusConfig { tone: Tone; label: string; }

const STATUS_MAP: Record<string, StatusConfig> = {
    paid:         { tone: 'success', label: 'Paid' },
    success:      { tone: 'success', label: 'Success' },
    active:       { tone: 'success', label: 'Active' },
    completed:    { tone: 'success', label: 'Completed' },
    in_stock:     { tone: 'success', label: 'In stock' },
    connected:    { tone: 'success', label: 'Connected' },
    approved:     { tone: 'success', label: 'Approved' },
    reconciled:   { tone: 'success', label: 'Reconciled' },

    overdue:      { tone: 'danger', label: 'Overdue' },
    error:        { tone: 'danger', label: 'Error' },
    failed:       { tone: 'danger', label: 'Failed' },
    rejected:     { tone: 'danger', label: 'Rejected' },
    out_of_stock: { tone: 'danger', label: 'Out of stock' },
    voided:       { tone: 'danger', label: 'Voided' },

    pending:      { tone: 'warning', label: 'Pending' },
    awaiting:     { tone: 'warning', label: 'Awaiting approval' },
    holding:      { tone: 'warning', label: 'On hold' },
    low_stock:    { tone: 'warning', label: 'Low stock' },
    partial:      { tone: 'warning', label: 'Partial' },
    unreconciled: { tone: 'warning', label: 'Unreconciled' },

    sent:         { tone: 'info', label: 'Sent' },
    processing:   { tone: 'info', label: 'Processing' },
    info:         { tone: 'info', label: 'Info' },

    draft:        { tone: 'neutral', label: 'Draft' },
    archived:     { tone: 'neutral', label: 'Archived' },
    closed:       { tone: 'neutral', label: 'Closed' },
};

const TONE_STYLES: Record<Tone, { bg: string; fg: string; border: string; dot: string }> = {
    success: { bg: 'bg-success-50',  fg: 'text-success-700',  border: 'border-success-200',  dot: 'bg-success-500' },
    danger:  { bg: 'bg-danger-50',   fg: 'text-danger-700',   border: 'border-danger-200',   dot: 'bg-danger-500' },
    warning: { bg: 'bg-warning-50',  fg: 'text-warning-800',  border: 'border-warning-200',  dot: 'bg-warning-500' },
    info:    { bg: 'bg-info-100',    fg: 'text-info-500',     border: 'border-primary-200',  dot: 'bg-info-500' },
    neutral: { bg: 'bg-neutral-100', fg: 'text-neutral-700',  border: 'border-neutral-300',  dot: 'bg-neutral-500' },
};

interface StatusTagProps {
    status?: string;
    label?: string;
    severity?: string;
    dot?: boolean;
    className?: string;
}

const normalize = (s: string) => s.toLowerCase().replace(/[\s-]+/g, '_');

const StatusTag = ({
    status,
    label,
    severity,
    dot = true,
    className = '',
}: StatusTagProps): React.ReactElement => {
    const key = status ? normalize(status) : '';
    const cfg = STATUS_MAP[key] || { tone: 'neutral' as Tone, label: status || '' };
    const t = TONE_STYLES[cfg.tone];
    const finalLabel = label ?? (severity ? `${cfg.label} ${severity}` : cfg.label);

    return (
        <span
            className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[11px] font-semibold whitespace-nowrap border ${t.bg} ${t.fg} ${t.border} ${className}`}
        >
            {dot && <span aria-hidden className={`inline-block w-1.5 h-1.5 rounded-full ${t.dot}`} />}
            <span>{finalLabel}</span>
        </span>
    );
};

export default StatusTag;
