export const ACCOUNT_TYPES = ['Asset', 'Liability', 'Equity', 'Revenue', 'Expense'] as const;
export const NORMAL_SIDES = ['Debit', 'Credit'] as const;

export type AccountTypeValue = (typeof ACCOUNT_TYPES)[number];
export type NormalSideValue = (typeof NORMAL_SIDES)[number];

const PRISMA_ACCOUNT_TYPE_BY_UI: Record<AccountTypeValue, string> = {
  Asset: 'ASSET',
  Liability: 'LIABILITY',
  Equity: 'EQUITY',
  Revenue: 'REVENUE',
  Expense: 'EXPENSE',
};

const UI_ACCOUNT_TYPE_BY_PRISMA = Object.fromEntries(
  Object.entries(PRISMA_ACCOUNT_TYPE_BY_UI).map(([ui, prisma]) => [prisma, ui]),
) as Record<string, AccountTypeValue>;

const PRISMA_NORMAL_SIDE_BY_UI: Record<NormalSideValue, string> = {
  Debit: 'DEBIT',
  Credit: 'CREDIT',
};

const UI_NORMAL_SIDE_BY_PRISMA = Object.fromEntries(
  Object.entries(PRISMA_NORMAL_SIDE_BY_UI).map(([ui, prisma]) => [prisma, ui]),
) as Record<string, NormalSideValue>;

export interface AccountRuleShape {
  id: string;
  code: string;
  name: string;
  type: string;
  parentId: string | null;
  level: number;
  isPostable: boolean;
  isActive: boolean;
  reportGroup: string | null;
  reportSubGroup: string | null;
  normalSide: string;
  hasPostings: boolean;
}

const NORMAL_SIDE_BY_TYPE: Record<AccountTypeValue, NormalSideValue> = {
  Asset: 'Debit',
  Liability: 'Credit',
  Equity: 'Credit',
  Revenue: 'Credit',
  Expense: 'Debit',
};

export function getNormalSideByType(type: AccountTypeValue): NormalSideValue {
  return NORMAL_SIDE_BY_TYPE[type];
}

export function fromPrismaAccountType(type: string): AccountTypeValue {
  return UI_ACCOUNT_TYPE_BY_PRISMA[type] ?? (type as AccountTypeValue);
}

export function toPrismaAccountType(type: AccountTypeValue): string {
  return PRISMA_ACCOUNT_TYPE_BY_UI[type];
}

export function fromPrismaNormalSide(normalSide: string): NormalSideValue {
  return UI_NORMAL_SIDE_BY_PRISMA[normalSide] ?? (normalSide as NormalSideValue);
}

export function toPrismaNormalSide(normalSide: NormalSideValue): string {
  return PRISMA_NORMAL_SIDE_BY_UI[normalSide];
}

export function getDescendantAccountIds(accountId: string, accounts: AccountRuleShape[]) {
  const childMap = accounts.reduce<Record<string, string[]>>((map, account) => {
    const key = account.parentId || 'root';
    if (!map[key]) map[key] = [];
    map[key].push(account.id);
    return map;
  }, {});

  const stack = [...(childMap[accountId] || [])];
  const descendants: string[] = [];

  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) continue;
    descendants.push(current);
    const children = childMap[current] || [];
    stack.push(...children);
  }

  return descendants;
}

function isCircularParent(accountId: string, nextParentId: string | null, accounts: AccountRuleShape[]) {
  if (!nextParentId) return false;
  if (accountId === nextParentId) return true;
  return getDescendantAccountIds(accountId, accounts).includes(nextParentId);
}

export function getAccountLevel(parentId: string | null, accounts: AccountRuleShape[]) {
  if (!parentId) return 0;
  const parent = accounts.find((account) => account.id === parentId);
  return parent ? parent.level + 1 : 0;
}

export function validateAccountState(
  next: Omit<AccountRuleShape, 'id' | 'level' | 'hasPostings'> & { id?: string; level?: number; hasPostings?: boolean },
  accounts: AccountRuleShape[],
  current?: AccountRuleShape | null,
) {
  const errors: Record<string, string> = {};

  if (!next.code?.trim()) errors.code = 'Account code is required.';
  if (!next.name?.trim()) errors.name = 'Account name is required.';
  if (!next.type) errors.type = 'Account type is required.';
  if (!next.reportGroup?.trim()) errors.reportGroup = 'Report group is required.';

  const duplicateCode = accounts.find(
    (account) => account.code === next.code && account.id !== current?.id,
  );
  if (duplicateCode) errors.code = 'Account code must be unique.';

  if (next.parentId) {
    const parent = accounts.find((account) => account.id === next.parentId);
    if (!parent) {
      errors.parentId = 'Parent account not found.';
    } else {
      if (parent.isPostable) {
        errors.parentId = 'Cannot use a postable account as parent.';
      }
      if (parent.type !== next.type) {
        errors.parentId = 'Child account type must match parent type.';
      }
      if (next.code && !next.code.startsWith(parent.code)) {
        errors.code = `Child code must start with parent code (${parent.code}).`;
      }
    }
  }

  if (current) {
    if (current.hasPostings) {
      if (current.type !== next.type) {
        errors.type = 'Type is locked because this account already has postings.';
      }
      if (current.normalSide !== next.normalSide) {
        errors.normalSide = 'Normal side is locked because this account already has postings.';
      }
      if (current.parentId !== next.parentId) {
        errors.parentId = 'Parent is locked because this account already has postings.';
      }
    }

    if (next.isPostable && accounts.some((account) => account.parentId === current.id)) {
      errors.isPostable = 'A postable account cannot have child accounts.';
    }

    if (isCircularParent(current.id, next.parentId, accounts)) {
      errors.parentId = 'Circular hierarchy is not allowed.';
    }
  }

  return errors;
}
