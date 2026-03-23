import React, { useState, useCallback } from 'react';
import Button from '../../components/UI/Button';
import { api } from '../../api/apiClient';

/**
 * localStorage key → { label, apiPath, transform? }
 *
 * Only stores that hold business data worth migrating.
 * Auth / UI-only stores (access, settings, integrations, workbench) are skipped.
 */
const MIGRATION_MAP = [
  {
    key: 'msm-customers',
    label: 'Pelanggan',
    apiPath: '/api/v1/customers',
    extract: (parsed) => parsed?.state?.customers ?? [],
    transform: (c) => ({
      name: c.name,
      code: c.code || c.id,
      email: c.email || '',
      phone: c.phone || '',
      address: c.address || '',
      creditLimit: Number(c.creditLimit ?? 0),
      paymentTermDays: Number(c.paymentTermDays ?? 30),
    }),
  },
  {
    key: 'msm-vendors',
    label: 'Vendor',
    apiPath: '/api/v1/vendors',
    extract: (parsed) => parsed?.state?.vendors ?? [],
    transform: (v) => ({
      name: v.name,
      code: v.code || v.id,
      email: v.email || '',
      phone: v.phone || '',
      address: v.address || '',
      paymentTermDays: Number(v.paymentTermDays ?? 30),
    }),
  },
  {
    key: 'msm-gl',
    label: 'Chart of Accounts',
    apiPath: '/api/v1/accounts',
    extract: (parsed) => parsed?.state?.accounts ?? [],
    transform: (a) => ({
      code: a.code || a.id,
      name: a.name,
      type: (a.type || 'Asset').toUpperCase(),
      parentId: a.parentId || null,
      isPostable: a.isPostable ?? true,
      isActive: a.isActive ?? true,
    }),
  },
  {
    key: 'msm-invoices',
    label: 'Faktur Penjualan',
    apiPath: '/api/v1/invoices',
    extract: (parsed) => parsed?.state?.invoices ?? [],
    transform: (inv) => ({
      customerId: inv.customerId,
      issueDate: inv.date || inv.issueDate,
      dueDate: inv.dueDate,
      status: (inv.status || 'DRAFT').toUpperCase(),
      totalAmount: Number(inv.amount ?? inv.totalAmount ?? 0),
      notes: inv.notes || '',
      poNumber: inv.poNumber || '',
      lines: (inv.lines || inv.items || []).map((l, i) => ({
        lineNo: i + 1,
        description: l.description || l.itemName || '',
        quantity: Number(l.quantity || l.qty || 1),
        unit: l.unit || 'PCS',
        price: Number(l.price || 0),
        lineTotal: Number(l.lineTotal || l.total || (l.quantity || 1) * (l.price || 0)),
      })),
    }),
  },
  {
    key: 'msm-bills',
    label: 'Tagihan Pembelian',
    apiPath: '/api/v1/bills',
    extract: (parsed) => parsed?.state?.bills ?? [],
    transform: (b) => ({
      vendorId: b.vendorId,
      issueDate: b.date || b.issueDate,
      dueDate: b.dueDate || b.due,
      status: (b.status || 'DRAFT').toUpperCase(),
      totalAmount: Number(b.amount ?? b.totalAmount ?? 0),
      notes: b.notes || '',
      lines: (b.lines || []).map((l, i) => ({
        lineNo: i + 1,
        description: l.description || '',
        quantity: Number(l.quantity || l.qty || 1),
        unit: l.unit || 'PCS',
        price: Number(l.price || 0),
        lineTotal: Number(l.lineTotal || (l.quantity || 1) * (l.price || 0)),
      })),
    }),
  },
  {
    key: 'msm-ar-payments',
    label: 'Pembayaran AR',
    apiPath: '/api/v1/ar-payments',
    extract: (parsed) => parsed?.state?.payments ?? [],
    transform: (p) => ({
      customerId: p.customerId,
      date: p.date,
      amount: Number(p.amount ?? p.totalAmount ?? 0),
      method: p.method || 'Bank Transfer',
      status: (p.status || 'COMPLETED').toUpperCase(),
    }),
  },
  {
    key: 'msm-ap-payments',
    label: 'Pembayaran AP',
    apiPath: '/api/v1/ap-payments',
    extract: (parsed) => parsed?.state?.apPayments ?? [],
    transform: (p) => ({
      vendorId: p.vendorId,
      date: p.date,
      amount: Number(p.amount ?? p.totalAmount ?? 0),
      method: p.method || 'Bank Transfer',
      status: (p.status || 'COMPLETED').toUpperCase(),
    }),
  },
  {
    key: 'msm-po-storage',
    label: 'Pesanan Pembelian',
    apiPath: '/api/v1/purchase-orders',
    extract: (parsed) => parsed?.state?.orders ?? parsed?.state?.purchaseOrders ?? [],
    transform: (po) => ({
      vendorId: po.vendorId,
      orderDate: po.date || po.orderDate,
      expectedDate: po.expectedDate || po.dueDate,
      status: (po.status || 'DRAFT').toUpperCase(),
      totalAmount: Number(po.amount ?? po.totalAmount ?? 0),
      lines: (po.lines || []).map((l, i) => ({
        lineNo: i + 1,
        description: l.description || l.itemName || '',
        quantity: Number(l.quantity || l.qty || 1),
        unit: l.unit || 'PCS',
        price: Number(l.price || 0),
        lineTotal: Number(l.lineTotal || (l.quantity || 1) * (l.price || 0)),
      })),
    }),
  },
  {
    key: 'msm-inventory',
    label: 'Barang / Item',
    apiPath: '/api/v1/items',
    extract: (parsed) => parsed?.state?.items ?? [],
    transform: (item) => ({
      name: item.name,
      sku: item.sku || item.code || item.id,
      unit: item.unit || 'PCS',
      buyPrice: Number(item.buyPrice ?? item.cost ?? 0),
      sellPrice: Number(item.sellPrice ?? item.price ?? 0),
      currentStock: Number(item.stock ?? item.currentStock ?? 0),
      minStock: Number(item.minStock ?? 0),
      category: item.category || '',
    }),
  },
  {
    key: 'msm-hr',
    label: 'Karyawan',
    apiPath: '/api/v1/employees',
    extract: (parsed) => parsed?.state?.employees ?? [],
    transform: (e) => ({
      name: e.name,
      email: e.email || '',
      phone: e.phone || '',
      department: e.department || '',
      position: e.position || e.jobTitle || '',
      joinDate: e.joinDate || e.startDate,
      status: (e.status || 'ACTIVE').toUpperCase(),
      basicSalary: Number(e.basicSalary ?? e.salary ?? 0),
    }),
  },
  {
    key: 'msm-banking',
    label: 'Rekening Bank',
    apiPath: '/api/v1/bank-accounts',
    extract: (parsed) => parsed?.state?.accounts ?? parsed?.state?.bankAccounts ?? [],
    transform: (ba) => ({
      name: ba.name || ba.bankName,
      bankName: ba.bankName || ba.name,
      accountNumber: ba.accountNumber || '',
      currentBalance: Number(ba.balance ?? ba.currentBalance ?? 0),
      type: (ba.type || 'BANK').toUpperCase(),
    }),
  },
];

const DataMigrationPanel = () => {
  const [results, setResults] = useState([]);
  const [running, setRunning] = useState(false);
  const [dryRun, setDryRun] = useState(true);

  const scanLocalStorage = useCallback(() => {
    return MIGRATION_MAP.map((cfg) => {
      const raw = localStorage.getItem(cfg.key);
      if (!raw) return { ...cfg, count: 0, records: [] };
      try {
        const parsed = JSON.parse(raw);
        const records = cfg.extract(parsed);
        return { ...cfg, count: records.length, records };
      } catch {
        return { ...cfg, count: 0, records: [], error: 'Parse error' };
      }
    }).filter((r) => r.count > 0);
  }, []);

  const handleScan = () => {
    const found = scanLocalStorage();
    setResults(
      found.map((r) => ({
        key: r.key,
        label: r.label,
        count: r.count,
        status: 'pending',
        migrated: 0,
        errors: 0,
      }))
    );
  };

  const handleMigrate = async () => {
    if (dryRun) {
      handleScan();
      return;
    }

    setRunning(true);
    const found = scanLocalStorage();
    const updatedResults = [];

    for (const cfg of found) {
      const result = { key: cfg.key, label: cfg.label, count: cfg.count, status: 'running', migrated: 0, errors: 0, errorMessages: [] };
      updatedResults.push(result);
      setResults([...updatedResults]);

      for (const record of cfg.records) {
        try {
          const payload = cfg.transform(record);
          await api.post(cfg.apiPath, payload);
          result.migrated++;
        } catch (err) {
          result.errors++;
          result.errorMessages.push(err?.message || 'Unknown error');
        }
      }

      result.status = result.errors > 0 ? 'partial' : 'done';
      setResults([...updatedResults]);
    }

    setRunning(false);
  };

  const totalFound = results.reduce((s, r) => s + r.count, 0);
  const totalMigrated = results.reduce((s, r) => s + r.migrated, 0);
  const totalErrors = results.reduce((s, r) => s + r.errors, 0);

  return (
    <div className="mt-4">
      <div className="flex items-center gap-4 mb-4">
        <Button
          text="Scan localStorage"
          variant="secondary"
          onClick={handleScan}
          disabled={running}
        />
        <label className="flex items-center gap-2 text-sm text-neutral-700">
          <input
            type="checkbox"
            checked={dryRun}
            onChange={(e) => setDryRun(e.target.checked)}
            disabled={running}
          />
          Dry Run (hanya scan, tidak migrasi)
        </label>
        <Button
          text={running ? 'Migrasi berjalan...' : 'Mulai Migrasi'}
          variant="primary"
          onClick={handleMigrate}
          disabled={running || results.length === 0}
        />
      </div>

      {results.length > 0 && (
        <>
          <div className="flex gap-4 mb-3 text-sm">
            <span className="text-neutral-600">Ditemukan: <strong>{totalFound}</strong> record</span>
            {!dryRun && (
              <>
                <span className="text-green-700">Berhasil: <strong>{totalMigrated}</strong></span>
                <span className="text-red-700">Gagal: <strong>{totalErrors}</strong></span>
              </>
            )}
          </div>

          <table className="w-full text-sm border border-neutral-200 rounded-md overflow-hidden">
            <thead className="bg-neutral-50">
              <tr>
                <th className="text-left px-3 py-2 font-medium">Store</th>
                <th className="text-right px-3 py-2 font-medium">Record</th>
                <th className="text-center px-3 py-2 font-medium">Status</th>
                {!dryRun && (
                  <>
                    <th className="text-right px-3 py-2 font-medium">Berhasil</th>
                    <th className="text-right px-3 py-2 font-medium">Gagal</th>
                  </>
                )}
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-200">
              {results.map((r) => (
                <tr key={r.key}>
                  <td className="px-3 py-2">
                    <div className="font-medium text-neutral-800">{r.label}</div>
                    <div className="text-xs text-neutral-400 font-mono">{r.key}</div>
                  </td>
                  <td className="text-right px-3 py-2">{r.count}</td>
                  <td className="text-center px-3 py-2">
                    {r.status === 'pending' && <span className="text-neutral-400">Siap</span>}
                    {r.status === 'running' && <span className="text-blue-600">Berjalan...</span>}
                    {r.status === 'done' && <span className="text-green-700">Selesai</span>}
                    {r.status === 'partial' && <span className="text-amber-600">Sebagian</span>}
                  </td>
                  {!dryRun && (
                    <>
                      <td className="text-right px-3 py-2 text-green-700">{r.migrated}</td>
                      <td className="text-right px-3 py-2 text-red-700">{r.errors}</td>
                    </>
                  )}
                </tr>
              ))}
            </tbody>
          </table>

          {!dryRun && results.some((r) => r.errorMessages?.length > 0) && (
            <details className="mt-3">
              <summary className="text-sm text-red-600 cursor-pointer">Lihat error detail</summary>
              <div className="mt-2 bg-red-50 rounded p-3 text-xs text-red-800 max-h-48 overflow-auto">
                {results
                  .filter((r) => r.errorMessages?.length)
                  .map((r) => (
                    <div key={r.key} className="mb-2">
                      <strong>{r.label}:</strong>
                      <ul className="list-disc ml-4">
                        {r.errorMessages.map((msg, i) => (
                          <li key={i}>{msg}</li>
                        ))}
                      </ul>
                    </div>
                  ))}
              </div>
            </details>
          )}
        </>
      )}

      {results.length === 0 && (
        <div className="text-sm text-neutral-500 mt-2">
          Klik "Scan localStorage" untuk mendeteksi data dari versi lama yang tersimpan di browser.
        </div>
      )}
    </div>
  );
};

export default DataMigrationPanel;
