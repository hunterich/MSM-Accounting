export interface PaymentAdjustment {
    settlementAmount?: number;
    discount: number;
    penalty: number;
}

const round = (amount: number) => Math.round((amount + Number.EPSILON) * 100) / 100;

/** Amount applied is principal cash; a discount also clears debt, a fee does not. */
export function paymentAllocation(balance: number, adjustment: PaymentAdjustment) {
    const settlement = round(adjustment.settlementAmount ?? balance);
    const discount = round(adjustment.discount ?? 0);
    const penalty = round(adjustment.penalty ?? 0);
    const amountApplied = round(settlement - discount);
    const cash = round(amountApplied + penalty);
    const valid = [balance, settlement, discount, penalty].every(Number.isFinite) &&
        settlement > 0 && settlement <= round(balance) && discount >= 0 &&
        discount <= settlement && penalty >= 0;
    return { settlement, discount, penalty, amountApplied, cash, valid };
}
