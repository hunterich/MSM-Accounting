export interface InvoiceFilters {
    searchTerm: string;
    status: string;
    dateFrom: string;
    dateTo: string;
}

/** Filtering belongs to the API so it searches beyond the currently loaded page. */
export function invoiceListQuery(filters: InvoiceFilters, page: number, limit: number) {
    return {
        page, limit,
        ...(filters.searchTerm.trim() && { search: filters.searchTerm.trim() }),
        ...(filters.status && { status: filters.status.toUpperCase().replaceAll(' ', '_') }),
        ...(filters.dateFrom && { dateFrom: filters.dateFrom }),
        ...(filters.dateTo && { dateTo: filters.dateTo }),
    };
}
