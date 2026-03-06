import React from 'react';

const colorMap = {
    success: 'bg-success-100 text-success-500',
    danger: 'bg-danger-100 text-danger-500',
    warning: 'bg-warning-100 text-warning-500',
    info: 'bg-info-100 text-info-500',
    neutral: 'bg-neutral-100 text-neutral-700',
};

const StatusTag = ({ status, label, className = '' }) => {
    let color = 'neutral';
    const s = status ? status.toLowerCase() : '';

    if (['paid', 'success', 'active', 'completed', 'in stock', 'connected'].includes(s)) {
        color = 'success';
    } else if (['overdue', 'error', 'failed', 'rejected', 'out of stock'].includes(s)) {
        color = 'danger';
    } else if (['pending', 'warning', 'holding', 'draft', 'low stock'].includes(s)) {
        color = 'warning';
    } else if (['info', 'processing', 'sent', 'partial'].includes(s)) {
        color = 'info';
    }

    return (
        <span className={`inline-flex items-center px-2 py-0.5 rounded-sm text-xs font-medium uppercase tracking-wide whitespace-nowrap ${colorMap[color]} ${className}`}>
            {label || status}
        </span>
    );
};

export default StatusTag;
