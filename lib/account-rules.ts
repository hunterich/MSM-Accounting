type AccountTypeLabel = 'Asset' | 'Liability' | 'Equity' | 'Revenue' | 'Expense';
type NormalSideLabel = 'Debit' | 'Credit';
type PrismaAccountTypeValue = 'ASSET' | 'LIABILITY' | 'EQUITY' | 'REVENUE' | 'EXPENSE';
type PrismaNormalSideValue = 'DEBIT' | 'CREDIT';

export interface RuleAccount {
  id: string;
  code: string;
  name: string;
  type: AccountTypeLabel;
  parentId: string | null;
  level: number;
  isPostable: boolean;
  isActive: boolean;
  reportGroup: string | null;
  reportSubGroup: string | null;
  normalSide: NormalSideLabel;
  hasPostings: boolean;
}

export interface AccountStateInput {
  code: string;
  name: string;
  type: AccountTypeLabel;
  parentId?: string | null;
  isPostable?: boolean;
  isActive?: boolean;
  reportGroup: string;
  reportSubGroup?: string | null;
  normalSide: NormalSideLabel;
}

const TYPE_NORMAL_SIDE: Record<AccountTypeLabel, NormalSideLabel> = {
  Asset: 'Debit',
  Liability: 'Credit',
  Equity: 'Credit',
  Revenue: 'Credit',
  Expense: 'Debit',
};

const ACCOUNT_TYPE_FROM_PRISMA: Record<PrismaAccountTypeValue, AccountTypeLabel> = {
  ASSET: 'Asset',
  LIABILITY: 'Liability',
  EQUITY: 'Equity',
  REVENUE: 'Revenue',
  EXPENSE: 'Expense',
};

const ACCOUNT_TYPE_TO_PRISMA: Record<AccountTypeLabel, PrismaAccountTypeValue> = {
  Asset: 'ASSET',
  Liability: 'LIABILITY',
  Equity: 'EQUITY',
  Revenue: 'REVENUE',
  Expense: 'EXPENSE',
};

const NORMAL_SIDE_FROM_PRISMA: Record<PrismaNormalSideValue, NormalSideLabel> = {
  DEBIT: 'Debit',
  CREDIT: 'Credit',
};

const NORMAL_SIDE_TO_PRISMA: Record<NormalSideLabel, PrismaNormalSideValue> = {
  Debit: 'DEBIT',
  Credit: 'CREDIT',
};

export function fromPrismaAccountType(value: string): AccountTypeLabel {
  return ACCOUNT_TYPE_FROM_PRISMA[value as PrismaAccountTypeValue] ?? 'Asset';
}

export function toPrismaAccountType(value: AccountTypeLabel): PrismaAccountTypeValue {
  return ACCOUNT_TYPE_TO_PRISMA[value];
}

export function fromPrismaNormalSide(value: string): NormalSideLabel {
  return NORMAL_SIDE_FROM_PRISMA[value as PrismaNormalSideValue] ?? 'Debit';
}

export function toPrismaNormalSide(value: NormalSideLabel): PrismaNormalSideValue {
  return NORMAL_SIDE_TO_PRISMA[value];
}

export function getNormalSideByType(type: AccountTypeLabel): NormalSideLabel {
  return TYPE_NORMAL_SIDE[type];
}

function getDescendantAccountIds(accountId: string, accounts: RuleAccount[]): string[] {
  const childMap = accounts.reduce<Record<string, string[]>>((map, account) => {
    const key = account.parentId ?? 'root';
    map[key] ??= [];
    map[key].push(account.id);
    return map;
  }, {});

  const stack = [...(childMap[accountId] ?? [])];
  const descendants: string[] = [];

  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) continue;
    descendants.push(current);
    stack.push(...(childMap[current] ?? []));
  }

  return descendants;
}

export function getAccountLevel(parentId: string | null | undefined, accounts: RuleAccount[]): number {
  if (!parentId) return 0;
  const parent = accounts.find((account) => account.id === parentId);
  return parent ? parent.level + 1 : 0;
}

export function validateAccountState(
  payload: AccountStateInput,
  accounts: RuleAccount[],
  currentId: string | null = null
): Record<string, string> {
  const errors: Record<string, string> = {};

  if (!payload.code.trim()) errors.code = 'Account code is required.';
  if (!payload.name.trim()) errors.name = 'Account name is required.';
  if (!payload.reportGroup.trim()) errors.reportGroup = 'Report group is required.';

  const duplicateCode = accounts.find(
    (account) => account.code === payload.code && account.id !== currentId
  );
  if (duplicateCode) {
    errors.code = 'Account code must be unique.';
  }

  if (payload.parentId) {
    const parent = accounts.find((account) => account.id === payload.parentId);
    if (!parent) {
      errors.parentId = 'Parent account not found.';
    } else {
      if (parent.isPostable) {
        errors.parentId = 'Cannot use a postable account as parent.';
      }
      if (parent.type !== payload.type) {
        errors.parentId = 'Child account type must match parent type.';
      }
      if (payload.code && !payload.code.startsWith(parent.code)) {
        errors.code = `Child code must start with parent code (${parent.code}).`;
      }
      if (currentId && getDescendantAccountIds(currentId, accounts).includes(payload.parentId)) {
        errors.parentId = 'Circular hierarchy is not allowed.';
      }
    }
  }

  if (payload.isPostable) {
    const hasChildren = accounts.some((account) => account.parentId === currentId);
    if (currentId && hasChildren) {
      errors.isPostable = 'A postable account cannot have child accounts.';
    }
  }

  return errors;
}
