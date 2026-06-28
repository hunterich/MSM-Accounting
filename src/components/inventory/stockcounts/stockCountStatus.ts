// Shared status-badge mapping for stock counts (workspace panes).
export function countStatusTag(status: string): { status: string; label: string } {
    switch (status) {
        case 'POSTED':    return { status: 'Success', label: 'Posted' };
        case 'SUBMITTED': return { status: 'Warning', label: 'Submitted' };
        case 'CANCELLED': return { status: 'Error',   label: 'Cancelled' };
        case 'VOIDED':    return { status: 'Error',   label: 'Voided' };
        default:          return { status: 'draft',   label: 'Draft' };
    }
}
