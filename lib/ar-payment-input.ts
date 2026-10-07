import { ApiError } from './errors';

/** Accept the shared cash-account alias without forwarding it to Prisma. */
export function normalizeArPaymentAccount<T extends { cashAccountId?: string; depositAccountId?: string; [key: string]: unknown }>(input: T): Omit<T, 'cashAccountId'> {
  const { cashAccountId, ...data } = input;
  if (cashAccountId && data.depositAccountId && cashAccountId !== data.depositAccountId) {
    throw new ApiError('cashAccountId and depositAccountId must identify the same account', 400);
  }
  return cashAccountId ? { ...data, depositAccountId: cashAccountId } : data;
}
