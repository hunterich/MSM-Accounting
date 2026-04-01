import type { AccountTypeValue } from './account-rules';

type AccountLike = {
  id: string;
  code: string;
  name: string;
  type: string;
  isActive: boolean;
  isPostable: boolean;
};

type BankAccountLike = {
  id: string;
  name?: string;
  code?: string;
  bankName?: string;
};

type AccountDefaultSpec = {
  label: string;
  description: string;
  allowedTypes: AccountTypeValue[];
  preferredIds?: string[];
  preferredCodes?: string[];
  keywords?: string[];
};

export const ACCOUNT_DEFAULT_SPECS = {
  bankAsset: {
    label: 'Bank / Cash Asset',
    description: 'Default asset account used when cash moves through bank or cash transactions.',
    allowedTypes: ['Asset'],
    preferredIds: ['COA-1120', 'COA-1110', 'COA-1130'],
    preferredCodes: ['112', '111', '113'],
    keywords: ['bank', 'kas', 'cash', 'giro'],
  },
  arControl: {
    label: 'Accounts Receivable',
    description: 'Default A/R control account for customer invoices and settlements.',
    allowedTypes: ['Asset'],
    preferredIds: ['COA-1210'],
    preferredCodes: ['121'],
    keywords: ['piutang usaha', 'accounts receivable', 'piutang'],
  },
  arDiscount: {
    label: 'Sales Discount Expense',
    description: 'Expense account used when customer payment discounts are granted.',
    allowedTypes: ['Expense'],
    preferredIds: ['COA-5300'],
    preferredCodes: ['53'],
    keywords: ['diskon penjualan', 'potongan penjualan', 'beban administrasi', 'discount'],
  },
  arPenalty: {
    label: 'Late Fee Revenue',
    description: 'Revenue account used for customer penalties or finance charges.',
    allowedTypes: ['Revenue'],
    preferredIds: ['COA-4200'],
    preferredCodes: ['42'],
    keywords: ['denda', 'pendapatan lain', 'finance charge', 'late fee'],
  },
  arReturn: {
    label: 'Sales Return / Allowance',
    description: 'Expense account used for sales returns and credit notes.',
    allowedTypes: ['Expense'],
    preferredIds: ['COA-5300'],
    preferredCodes: ['53'],
    keywords: ['retur penjualan', 'sales return', 'allowance', 'beban administrasi'],
  },
  arTax: {
    label: 'Output Tax Payable',
    description: 'Liability account used for tax on sales returns and credit notes.',
    allowedTypes: ['Liability'],
    preferredIds: ['COA-2200'],
    preferredCodes: ['22'],
    keywords: ['hutang pajak', 'ppn keluaran', 'tax payable', 'pajak'],
  },
  apControl: {
    label: 'Accounts Payable',
    description: 'Default A/P control account for vendor bills and settlements.',
    allowedTypes: ['Liability'],
    preferredIds: ['COA-2100'],
    preferredCodes: ['21'],
    keywords: ['hutang usaha', 'accounts payable', 'hutang'],
  },
  apDiscount: {
    label: 'Purchase Discount Income',
    description: 'Revenue account used when vendor payment discounts are received.',
    allowedTypes: ['Revenue'],
    preferredIds: ['COA-4200'],
    preferredCodes: ['42'],
    keywords: ['diskon pembelian', 'purchase discount', 'pendapatan lain'],
  },
  apPenalty: {
    label: 'Vendor Penalty Expense',
    description: 'Expense account used for late fees or penalties charged by vendors.',
    allowedTypes: ['Expense'],
    preferredIds: ['COA-5300'],
    preferredCodes: ['53'],
    keywords: ['denda', 'penalty', 'beban administrasi'],
  },
  apReturn: {
    label: 'Purchase Return / Allowance',
    description: 'Expense or contra purchase account used for purchase returns and debit notes.',
    allowedTypes: ['Expense', 'Asset'],
    preferredIds: ['COA-5300'],
    preferredCodes: ['53'],
    keywords: ['retur pembelian', 'purchase return', 'allowance', 'beban administrasi'],
  },
  apTax: {
    label: 'Input Tax Receivable',
    description: 'Asset account used for tax on purchase returns and debit notes.',
    allowedTypes: ['Asset'],
    preferredIds: ['COA-1210'],
    preferredCodes: ['121'],
    keywords: ['ppn masukan', 'tax receivable', 'piutang pajak', 'piutang'],
  },
  inventoryAsset: {
    label: 'Inventory Asset',
    description: 'Inventory control account used for stocked items.',
    allowedTypes: ['Asset'],
    preferredIds: ['COA-1310'],
    preferredCodes: ['131'],
    keywords: ['persediaan barang dagang', 'inventory', 'persediaan'],
  },
  salesRevenue: {
    label: 'Sales Revenue',
    description: 'Primary revenue account for inventory sales.',
    allowedTypes: ['Revenue'],
    preferredIds: ['COA-4100'],
    preferredCodes: ['41'],
    keywords: ['penjualan', 'sales', 'revenue', 'pendapatan'],
  },
  cogsExpense: {
    label: 'Cost of Goods Sold',
    description: 'Expense account used for cost of goods sold.',
    allowedTypes: ['Expense'],
    preferredIds: ['COA-5100'],
    preferredCodes: ['51'],
    keywords: ['hpp', 'harga pokok penjualan', 'cost of goods sold'],
  },
} satisfies Record<string, AccountDefaultSpec>;

export type AccountDefaultKey = keyof typeof ACCOUNT_DEFAULT_SPECS;
export type AccountDefaultsConfig = Record<AccountDefaultKey, string>;

export const DEFAULT_ACCOUNT_DEFAULTS: AccountDefaultsConfig = Object.fromEntries(
  Object.keys(ACCOUNT_DEFAULT_SPECS).map((key) => [key, '']),
) as AccountDefaultsConfig;

const normalize = (value: string | null | undefined) =>
  String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

const includesKeyword = (haystack: string, keywords: string[]) =>
  keywords.some((keyword) => haystack.includes(normalize(keyword)));

const byAllowedType = (account: AccountLike, key: AccountDefaultKey) => {
  const allowedTypes = ACCOUNT_DEFAULT_SPECS[key].allowedTypes as readonly AccountTypeValue[];
  return allowedTypes.includes(account.type as AccountTypeValue);
};

export const isSelectableAccount = (account: AccountLike | null | undefined) =>
  Boolean(account?.isActive && account?.isPostable);

export function isAccountUsableForRole(account: AccountLike | null | undefined, key: AccountDefaultKey) {
  return Boolean(account && isSelectableAccount(account) && byAllowedType(account, key));
}

function resolvePreferredMatch(accounts: AccountLike[], key: AccountDefaultKey) {
  const spec = ACCOUNT_DEFAULT_SPECS[key];
  const candidates = accounts.filter((account) => isAccountUsableForRole(account, key));

  const byId = spec.preferredIds?.find((preferredId) => candidates.some((account) => account.id === preferredId));
  if (byId) return candidates.find((account) => account.id === byId)?.id || '';

  const byCode = spec.preferredCodes?.find((preferredCode) =>
    candidates.some((account) => normalize(account.code) === normalize(preferredCode)),
  );
  if (byCode) {
    return candidates.find((account) => normalize(account.code) === normalize(byCode))?.id || '';
  }

  if (spec.keywords?.length) {
    const keywordMatch = candidates.find((account) =>
      includesKeyword(`${account.code} ${account.name}`, spec.keywords || []),
    );
    if (keywordMatch) return keywordMatch.id;
  }

  return candidates[0]?.id || '';
}

export function resolveAccountDefaultId(
  accounts: AccountLike[],
  settings: Partial<AccountDefaultsConfig> | undefined,
  key: AccountDefaultKey,
) {
  const configuredId = settings?.[key];
  const configuredAccount = accounts.find((account) => account.id === configuredId);
  if (isAccountUsableForRole(configuredAccount, key)) {
    return configuredAccount?.id || '';
  }

  return resolvePreferredMatch(accounts, key);
}

export function resolveAccountDefaults(
  accounts: AccountLike[],
  settings: Partial<AccountDefaultsConfig> | undefined,
) {
  return Object.keys(ACCOUNT_DEFAULT_SPECS).reduce((resolved, key) => {
    const accountKey = key as AccountDefaultKey;
    resolved[accountKey] = resolveAccountDefaultId(accounts, settings, accountKey);
    return resolved;
  }, { ...DEFAULT_ACCOUNT_DEFAULTS });
}

export function resolveBankLinkedAssetAccountId(
  bankAccounts: BankAccountLike[],
  accounts: AccountLike[],
  settings: Partial<AccountDefaultsConfig> | undefined,
  bankId: string | null | undefined,
) {
  const bank = bankAccounts.find((account) => account.id === bankId);
  if (!bank) return resolveAccountDefaultId(accounts, settings, 'bankAsset');

  const candidates = accounts.filter((account) => isAccountUsableForRole(account, 'bankAsset'));
  const bankKeywords = [bank.code, bank.bankName, bank.name]
    .map((value) => normalize(value))
    .filter(Boolean);

  if (bankKeywords.length > 0) {
    const matched = candidates.find((account) => {
      const haystack = normalize(`${account.code} ${account.name}`);
      return bankKeywords.some((keyword) => haystack.includes(keyword));
    });
    if (matched) return matched.id;
  }

  return resolveAccountDefaultId(accounts, settings, 'bankAsset');
}
