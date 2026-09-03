import { describe, it, expect } from 'vitest';
import { moduleKeyOf, isDocumentModule, docModuleTitle, pageModuleForPath, DOC_MODULES, pendingNoteRecordId, pendingNotePath, newDocumentTabForPath } from '../modules';

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

describe('pending credit/debit notes spawned by a return', () => {
  it('derives a tab recordId that is stable per return, so re-saving focuses the same tab', () => {
    expect(pendingNoteRecordId('credit', 'SRN/2026/08/00001')).toBe('new-credit:SRN/2026/08/00001');
    expect(pendingNoteRecordId('debit', 'PRN/2026/08/00002')).toBe('new-debit:PRN/2026/08/00002');
    // Two different returns must not collide onto one tab.
    expect(pendingNoteRecordId('credit', 'A')).not.toBe(pendingNoteRecordId('credit', 'B'));
  });

  it('never collides with the saved-note or source-return recordId prefixes', () => {
    const pending = pendingNoteRecordId('credit', 'X');
    expect(pending.startsWith('credit:')).toBe(false);
    expect(pending.startsWith('return:')).toBe(false);
    expect(pendingNoteRecordId('debit', 'X').startsWith('debit:')).toBe(false);
  });

  it('builds a deep link that names the source return and survives URL encoding', () => {
    expect(pendingNotePath('credit', 'SRN/2026/08/00001'))
      .toBe('/ar/credits/new?fromReturn=SRN%2F2026%2F08%2F00001');
    expect(pendingNotePath('debit', 'PRN/2026/08/00002'))
      .toBe('/ap/debits/new?fromReturn=PRN%2F2026%2F08%2F00002');
  });

  it('round-trips the return key back out of the path', () => {
    const key = 'SRN/2026/08/00001';
    const parsed = new URLSearchParams(pendingNotePath('credit', key).split('?')[1]);
    expect(parsed.get('fromReturn')).toBe(key);
  });
});

describe('newDocumentTabForPath (direct links to "new" forms)', () => {
  const q = (s = '') => new URLSearchParams(s);

  it('maps every document module\'s newPath to a blank doc-form tab', () => {
    for (const m of Object.values(DOC_MODULES)) {
      if (!m.newPath) continue;
      if (m.module === 'banking') continue; // one tab per action, covered below
      const spec = newDocumentTabForPath(m.newPath.split('?')[0], q());
      expect(spec, m.newPath).toMatchObject({
        kind: 'doc-form',
        target: { module: m.module, entity: m.entity, recordId: null, mode: 'create' },
        path: m.newPath,
      });
      expect(spec?.title).toBe(m.newLabel ?? 'New');
    }
  });

  it('tolerates the ?mode=create the vendor "New" path carries', () => {
    expect(newDocumentTabForPath('/ap/vendors/new', q('mode=create'))?.target).toMatchObject({ module: 'ap', entity: 'vendor', recordId: null });
  });

  it('maps the banking action forms to their one-per-action tabs', () => {
    expect(newDocumentTabForPath('/banking/payment', q())?.target).toMatchObject({ module: 'banking', entity: 'transaction', recordId: 'new:expense' });
    expect(newDocumentTabForPath('/banking/receive', q())?.target.recordId).toBe('new:income');
    expect(newDocumentTabForPath('/banking/transfer', q())?.target.recordId).toBe('new:transfer');
    expect(newDocumentTabForPath('/banking/account', q())?.target.recordId).toBe('new:account');
  });

  it('leaves links to existing records to the per-module mapping', () => {
    expect(newDocumentTabForPath('/ap/bills/new', q('billId=b1&mode=view'))).toBeNull();
    expect(newDocumentTabForPath('/ap/vendors/new', q('vendorId=v1&mode=edit'))).toBeNull();
    expect(newDocumentTabForPath('/ar/returns/new', q('returnId=r1'))).toBeNull();
    expect(newDocumentTabForPath('/ar/credits/new', q('fromReturn=r1'))).toBeNull();
  });

  it('is null for lists, records and page routes', () => {
    expect(newDocumentTabForPath('/ar/invoices', q())).toBeNull();
    expect(newDocumentTabForPath('/ar/invoices', q('invoiceId=i1'))).toBeNull();
    expect(newDocumentTabForPath('/banking', q())).toBeNull();
    expect(newDocumentTabForPath('/banking/reconciliation', q())).toBeNull();
    expect(newDocumentTabForPath('/gl/journals/new', q())).toBeNull();
  });
});
