/** A return-window notice on a delivered order is not a return request. */
export function isMarketplaceCancelledStatus(status: string): boolean {
    return /^(cancel|batal|dibatalkan)/i.test(status.trim());
}

export function isMarketplaceReversalStatus(status: string): boolean {
    return /^(cancel|batal|dibatalkan|return|refund|pengembalian|dikembalikan)/i.test(status.trim());
}

export function isMarketplaceShippedStatus(status: string): boolean {
    return /^(shipped|in transit|delivered|completed|selesai|dikirim|sedang dikirim|pesanan diterima)/i.test(status.trim());
}
