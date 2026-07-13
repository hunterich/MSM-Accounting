export interface ReconcileInput {
  controlCodes: { ar: string; ap: string; inventory: string };
  trialBalance: { accountCode: string; debit: number; credit: number }[];
  openAr: { amount: number }[];
  openAp: { amount: number }[];
  openingStock: { value: number }[];
}

export interface ReconcileCheck {
  id: 'tb-balanced' | 'ar-tie' | 'ap-tie' | 'inventory-tie';
  label: string;
  expected: number;
  actual: number;
  pass: boolean;
}

export interface ReconcileResult {
  ok: boolean;
  checks: ReconcileCheck[];
}

const TOL = 0.01;
const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const sum = (arr: number[]) => round2(arr.reduce((a, b) => a + b, 0));

function tbBalance(tb: ReconcileInput['trialBalance'], code: string): number {
  const rows = tb.filter((r) => r.accountCode === code);
  return round2(rows.reduce((a, r) => a + r.debit - r.credit, 0));
}

export function reconcileMigration(input: ReconcileInput): ReconcileResult {
  const totalDebit = sum(input.trialBalance.map((r) => r.debit));
  const totalCredit = sum(input.trialBalance.map((r) => r.credit));

  const arControl = tbBalance(input.trialBalance, input.controlCodes.ar);        // debit-normal
  const apControl = -tbBalance(input.trialBalance, input.controlCodes.ap);       // credit-normal → flip sign
  const invControl = tbBalance(input.trialBalance, input.controlCodes.inventory); // debit-normal

  const arActual = sum(input.openAr.map((x) => x.amount));
  const apActual = sum(input.openAp.map((x) => x.amount));
  const invActual = sum(input.openingStock.map((x) => x.value));

  const mk = (
    id: ReconcileCheck['id'], label: string, expected: number, actual: number,
  ): ReconcileCheck => ({ id, label, expected, actual, pass: Math.abs(expected - actual) <= TOL });

  const checks: ReconcileCheck[] = [
    mk('tb-balanced', 'Trial balance debits equal credits', totalDebit, totalCredit),
    mk('ar-tie', 'Open AR invoices tie to AR control account', arControl, arActual),
    mk('ap-tie', 'Open AP bills tie to AP control account', apControl, apActual),
    mk('inventory-tie', 'Opening stock value ties to inventory account', invControl, invActual),
  ];

  return { ok: checks.every((c) => c.pass), checks };
}
