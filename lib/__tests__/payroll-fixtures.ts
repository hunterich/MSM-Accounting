import type { BPJSRules } from '../payroll-rules';
// Explicit fixtures, never production defaults. Payroll requires dated company settings.
export const TEST_BPJS: BPJSRules = {
  kesehatan: { employee: 0.01, employer: 0.04, ceiling: 12_000_000, floor: 0 },
  jht: { employee: 0.02, employer: 0.037 },
  jp: { employee: 0.01, employer: 0.02, ceiling: 10_042_300 },
  jkk: { employer: 0.0024 },
  jkm: { employer: 0.003 },
};
