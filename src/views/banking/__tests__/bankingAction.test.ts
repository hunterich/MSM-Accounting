import { describe, it, expect } from 'vitest';
import { getActionFromPath, ACTION_TITLES } from '../bankingAction';

describe('getActionFromPath', () => {
  it('maps the new Accurate-style /banking/payment to the internal "expense" action', () => {
    expect(getActionFromPath('/banking/payment')).toBe('expense');
  });
  it('maps the new /banking/receive to the internal "income" action', () => {
    expect(getActionFromPath('/banking/receive')).toBe('income');
  });
  it('keeps the legacy /banking/expense and /banking/income paths working', () => {
    expect(getActionFromPath('/banking/expense')).toBe('expense');
    expect(getActionFromPath('/banking/income')).toBe('income');
  });
  it('maps transfer and falls back to account', () => {
    expect(getActionFromPath('/banking/transfer')).toBe('transfer');
    expect(getActionFromPath('/banking/account')).toBe('account');
  });
});

describe('ACTION_TITLES', () => {
  it('uses Accurate-style labels for expense/income', () => {
    expect(ACTION_TITLES.expense).toBe('Payment');
    expect(ACTION_TITLES.income).toBe('Receive');
  });
});
