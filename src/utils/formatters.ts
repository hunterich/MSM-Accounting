export const formatIDR = (amount: number | string | null | undefined): string => {
    const raw = Number(amount || 0);
    const num = Number.isNaN(raw) ? 0 : raw;
    return new Intl.NumberFormat('id-ID', {
        style: 'currency',
        currency: 'IDR',
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    }).format(num);
};

export const formatDateID = (dateStr: string | null | undefined): string => {
    if (!dateStr) return '';
    const date = new Date(dateStr);
    if (Number.isNaN(date.getTime())) return dateStr;
    return new Intl.DateTimeFormat('id-ID', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric'
    }).format(date);
};

export const formatNumber = (num: number | string | null | undefined): string => {
    const value = Number(num || 0);
    return new Intl.NumberFormat('id-ID').format(value);
};
