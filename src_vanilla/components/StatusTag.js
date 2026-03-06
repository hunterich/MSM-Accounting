export function StatusTag({ status, label, className = '' }) {
    const tag = document.createElement('span');

    // Map logic for status to color
    let colorClass = 'status-neutral';
    const s = status.toLowerCase();

    if (['paid', 'success', 'active', 'completed'].includes(s)) {
        colorClass = 'status-success';
    } else if (['overdue', 'error', 'failed', 'rejected'].includes(s)) {
        colorClass = 'status-danger';
    } else if (['pending', 'warning', 'holding', 'draft'].includes(s)) {
        colorClass = 'status-warning';
    } else if (['info', 'processing', 'sent', 'partial'].includes(s)) {
        colorClass = 'status-info';
    }

    tag.className = `status-tag ${colorClass} ${className}`;
    tag.textContent = label || status; // Capitalize first letter logic could be added here

    return tag;
}
