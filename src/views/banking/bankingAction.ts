export type BankingAction = 'transfer' | 'expense' | 'income' | 'account';

/**
 * Maps a banking form route path to its internal action.
 * The new Accurate-style URLs (/banking/payment, /banking/receive) deliberately
 * map onto the EXISTING internal actions (expense, income) so the API contract
 * to /v1/bank-transactions is unchanged.
 */
export const getActionFromPath = (path: string): BankingAction => {
  if (path.includes('transfer')) return 'transfer';
  if (path.includes('payment') || path.includes('expense')) return 'expense';
  if (path.includes('receive') || path.includes('income')) return 'income';
  return 'account';
};

export const ACTION_TITLES: Record<BankingAction, string> = {
  transfer: 'Bank Transfer',
  expense:  'Payment',
  income:   'Receive',
  account:  'Add Bank Account',
};
