import { describe, it, expect } from 'vitest';
import { moduleKeyOf, isDocumentModule, docModuleTitle, pageModuleForPath, DOC_MODULES } from '../modules';

describe('reports workspace module registration', () => {
  it('groups every reports tab under the single "reports" module key', () => {
    expect(moduleKeyOf({ module: 'reports', entity: 'catalog', recordId: 'catalog', mode: 'view' })).toBe('reports');
    expect(moduleKeyOf({ module: 'reports', entity: 'bank-history', recordId: null, mode: 'view' })).toBe('reports');
  });

  it('is a document module titled "Reports" with no "New" action', () => {
    expect(isDocumentModule('reports')).toBe(true);
    expect(docModuleTitle('reports')).toBe('Reports');
    expect(DOC_MODULES['reports'].newPath).toBeFalsy();
    expect(DOC_MODULES['reports'].listPath).toBe('/reports');
  });

  it('keeps the standalone bank-reconciliation route as its own page module', () => {
    expect(pageModuleForPath('/reports/bank-reconciliation').key).toBe('reports-reconciliation');
  });
});
