import React, { useRef, useState } from 'react';
import Button from '../../components/UI/Button';
import Card from '../../components/UI/Card';
import { Upload, Download, CheckCircle, AlertCircle, X } from 'lucide-react';
import { useImport, type ImportEntity, type ImportRow } from '../../hooks/useImport';

// ── CSV templates ─────────────────────────────────────────────────────────────

const TEMPLATES: Record<ImportEntity, { columns: string[]; sample: string[][]; hint?: string }> = {
  customers: {
    columns: ['name', 'email', 'phone', 'address', 'npwp', 'creditLimit', 'paymentTerms', 'openingBalance'],
    sample: [['PT Maju Bersama', 'info@majubersama.com', '021-5551234', 'Jl. Sudirman No.1 Jakarta', '01.234.567.8-901.000', '50000000', '30', '12500000']],
    hint: 'openingBalance = outstanding AR from prior system',
  },
  vendors: {
    columns: ['name', 'email', 'phone', 'address', 'npwp', 'paymentTerms', 'openingBalance'],
    sample: [['CV Sumber Jaya', 'vendor@sumberjaya.co.id', '021-5559876', 'Jl. Gatot Subroto No.5 Jakarta', '02.345.678.9-012.000', '14', '8000000']],
    hint: 'openingBalance = outstanding AP from prior system',
  },
  items: {
    columns: ['name', 'sku', 'type', 'unit', 'salePrice', 'purchasePrice', 'trackInventory', 'openingStock', 'openingValue'],
    sample: [['Laptop Asus VivoBook', 'LAP-ASUS-001', 'PRODUCT', 'PCS', '8500000', '7000000', 'true', '25', '175000000']],
    hint: 'openingStock = qty on hand, openingValue = total cost value of stock',
  },
  accounts: {
    columns: ['code', 'name', 'type', 'description'],
    sample: [['1-1010', 'Kas Besar', 'ASSET', 'Cash on hand'], ['4-1000', 'Pendapatan Jasa', 'REVENUE', 'Service revenue']],
  },
  'opening-journal': {
    columns: ['accountCode', 'debit', 'credit', 'description'],
    sample: [
      ['1-1010', '100000000', '0', 'Cash opening balance'],
      ['1-1200', '50000000', '0', 'Accounts Receivable opening'],
      ['2-1000', '0', '30000000', 'Accounts Payable opening'],
      ['3-1000', '0', '120000000', 'Retained Earnings opening'],
    ],
    hint: 'One row per GL account. Total debits must equal total credits. Uses existing COA codes.',
  },
  'opening-invoices': {
    columns: ['customerName', 'invoiceNumber', 'issueDate', 'dueDate', 'amount', 'notes'],
    sample: [
      ['PT Maju Bersama', 'INV-2025-001', '2025-11-15', '2025-12-15', '12500000', 'Unpaid from prior system'],
      ['CV Abadi Sentosa', '', '2025-10-01', '2025-11-01', '8750000', ''],
    ],
    hint: 'Creates open (unpaid) invoices as accounts-receivable subledger detail. These do NOT post to the General Ledger — import a matching Opening Balance Journal to set the AR control account.',
  },
  'opening-bills': {
    columns: ['vendorName', 'billNumber', 'issueDate', 'dueDate', 'amount', 'notes'],
    sample: [
      ['CV Sumber Jaya', 'BILL-2025-042', '2025-12-01', '2026-01-01', '8000000', 'Unpaid from prior system'],
    ],
    hint: 'Creates open (unpaid) bills as accounts-payable subledger detail. These do NOT post to the General Ledger — import a matching Opening Balance Journal to set the AP control account.',
  },
};

function toCsv(columns: string[], rows: string[][]): string {
  return [columns.join(','), ...rows.map((r) => r.map((c) => `"${c}"`).join(','))].join('\n');
}

function downloadCsv(filename: string, content: string) {
  const blob = new Blob([content], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// ── CSV parser (no external dep) ──────────────────────────────────────────────

function parseCsvText(text: string): string[][] {
  const lines = text.trim().split(/\r?\n/);
  return lines.map((line) => {
    const row: string[] = [];
    let cur = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQuotes && line[i + 1] === '"') { cur += '"'; i++; }
        else inQuotes = !inQuotes;
      } else if (ch === ',' && !inQuotes) {
        row.push(cur.trim());
        cur = '';
      } else {
        cur += ch;
      }
    }
    row.push(cur.trim());
    return row;
  });
}

// ── Component ─────────────────────────────────────────────────────────────────

type Step = 'select' | 'preview' | 'done';

const ENTITY_LABELS: Record<ImportEntity, string> = {
  customers: 'Customers',
  vendors: 'Vendors',
  items: 'Items',
  accounts: 'Chart of Accounts',
  'opening-journal': 'Opening Balance Journal',
  'opening-invoices': 'Opening AR Invoices',
  'opening-bills': 'Opening AP Bills',
};

const CsvImportPanel: React.FC = () => {
  const [entity, setEntity] = useState<ImportEntity>('customers');
  const [step, setStep] = useState<Step>('select');
  const [parsedRows, setParsedRows] = useState<ImportRow[]>([]);
  const [headerRow, setHeaderRow] = useState<string[]>([]);
  const [fileName, setFileName] = useState('');
  const [dryRunResult, setDryRunResult] = useState<{ valid: number; invalid: number; errors: { row: number; message: string }[] } | null>(null);
  const [importResult, setImportResult] = useState<{ created: number; skipped: number; errors: { row: number; message: string }[] } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const { mutate: runImport, isPending } = useImport(entity);

  const reset = () => {
    setStep('select');
    setParsedRows([]);
    setHeaderRow([]);
    setFileName('');
    setDryRunResult(null);
    setImportResult(null);
    if (fileRef.current) fileRef.current.value = '';
  };

  const handleEntityChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    setEntity(e.target.value as ImportEntity);
    reset();
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result as string;
      const rows = parseCsvText(text);
      if (rows.length < 2) { alert('CSV must have at least a header row and one data row.'); return; }
      const headers = rows[0].map((h) => h.toLowerCase().replace(/\s+/g, ''));
      setHeaderRow(headers);
      const dataRows: ImportRow[] = rows.slice(1).map((r) =>
        Object.fromEntries(headers.map((h, i) => [h, r[i] ?? ''])),
      );
      setParsedRows(dataRows);
      // Dry run
      runImport({ rows: dataRows, dryRun: true }, {
        onSuccess: (result) => {
          setDryRunResult({ valid: result.valid ?? 0, invalid: result.invalid ?? 0, errors: result.errors });
          setStep('preview');
        },
        onError: (err) => alert(`Validation failed: ${err.message}`),
      });
    };
    reader.readAsText(file);
  };

  const handleConfirmImport = () => {
    runImport({ rows: parsedRows }, {
      onSuccess: (result) => {
        setImportResult({ created: result.created ?? 0, skipped: result.skipped ?? 0, errors: result.errors });
        setStep('done');
      },
      onError: (err) => alert(`Import failed: ${err.message}`),
    });
  };

  const template = TEMPLATES[entity];

  return (
    <div className="space-y-4">
      <div className="flex items-end gap-4">
        <div className="flex-1 max-w-xs">
          <label className="form-label">Entity Type</label>
          <select
            className="block w-full px-3 text-sm leading-normal text-neutral-900 bg-neutral-0 border border-neutral-300 rounded-md h-10 focus:border-primary-500 focus:outline-0"
            value={entity}
            onChange={handleEntityChange}
          >
            {(Object.keys(ENTITY_LABELS) as ImportEntity[]).map((e) => (
              <option key={e} value={e}>{ENTITY_LABELS[e]}</option>
            ))}
          </select>
        </div>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => downloadCsv(`template-${entity}.csv`, toCsv(template.columns, template.sample))}
        >
          <Download size={14} className="mr-1" /> Download Template
        </Button>
      </div>

      {step === 'select' && (
        <Card>
          <div
            className="border-2 border-dashed border-neutral-300 rounded-lg p-10 text-center cursor-pointer hover:border-primary-400 transition-colors"
            onClick={() => fileRef.current?.click()}
          >
            <Upload size={32} className="mx-auto text-neutral-400 mb-2" />
            <p className="text-neutral-600 font-medium">Click to upload CSV file</p>
            <p className="text-xs text-neutral-400 mt-1">Must match the template columns</p>
          </div>
          <input ref={fileRef} type="file" accept=".csv" className="hidden" onChange={handleFileChange} />
          {isPending && <p className="text-sm text-neutral-500 mt-2">Validating rows…</p>}
        </Card>
      )}

      {step === 'preview' && dryRunResult && (
        <Card>
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-base font-semibold text-neutral-800">Preview: {fileName}</h3>
            <button onClick={reset} className="text-neutral-400 hover:text-neutral-600"><X size={18} /></button>
          </div>

          <div className="flex gap-4 mb-4">
            <div className="flex items-center gap-2 text-sm bg-success-50 text-success-700 border border-success-200 rounded px-3 py-1.5">
              <CheckCircle size={14} /> {dryRunResult.valid} valid rows
            </div>
            {dryRunResult.invalid > 0 && (
              <div className="flex items-center gap-2 text-sm bg-danger-50 text-danger-600 border border-danger-200 rounded px-3 py-1.5">
                <AlertCircle size={14} /> {dryRunResult.invalid} invalid rows
              </div>
            )}
          </div>

          {dryRunResult.errors.length > 0 && (
            <div className="bg-danger-50 border border-danger-200 rounded p-3 mb-4 max-h-40 overflow-y-auto">
              <p className="text-sm font-semibold text-danger-700 mb-1">Errors (will be skipped):</p>
              {dryRunResult.errors.map((e, i) => (
                <p key={i} className="text-xs text-danger-600">Row {e.row}: {e.message}</p>
              ))}
            </div>
          )}

          <div className="overflow-x-auto max-h-52 border border-neutral-200 rounded mb-4">
            <table className="text-xs w-full">
              <thead className="bg-neutral-50 sticky top-0">
                <tr>{headerRow.map((h) => <th key={h} className="px-3 py-2 text-left font-semibold border-b border-neutral-200">{h}</th>)}</tr>
              </thead>
              <tbody>
                {parsedRows.slice(0, 20).map((row, i) => (
                  <tr key={i} className="even:bg-neutral-50">
                    {headerRow.map((h) => <td key={h} className="px-3 py-1.5 border-b border-neutral-100">{String(row[h] ?? '')}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
            {parsedRows.length > 20 && <p className="text-xs text-neutral-400 p-2">…and {parsedRows.length - 20} more rows</p>}
          </div>

          <div className="flex gap-2">
            <Button
              variant="primary"
              disabled={dryRunResult.valid === 0 || isPending}
              onClick={handleConfirmImport}
            >
              {isPending ? 'Importing…' : `Import ${dryRunResult.valid} rows`}
            </Button>
            <Button variant="secondary" onClick={reset}>Cancel</Button>
          </div>
        </Card>
      )}

      {step === 'done' && importResult && (
        <Card>
          <div className="flex items-start gap-3">
            <CheckCircle size={24} className="text-success-600 mt-0.5 shrink-0" />
            <div>
              <p className="font-semibold text-success-700">Import complete</p>
              <p className="text-sm text-neutral-600 mt-0.5">
                {importResult.created} {ENTITY_LABELS[entity].toLowerCase()} created
                {importResult.skipped > 0 ? `, ${importResult.skipped} skipped` : ''}.
              </p>
              {importResult.errors.length > 0 && (
                <div className="mt-2">
                  {importResult.errors.map((e, i) => (
                    <p key={i} className="text-xs text-amber-600">{e.message}</p>
                  ))}
                </div>
              )}
              <Button variant="secondary" size="sm" className="mt-3" onClick={reset}>Import More</Button>
            </div>
          </div>
        </Card>
      )}

      <div className="text-xs text-neutral-400 border-t pt-3 mt-2">
        <p className="font-medium mb-1">Column reference for {ENTITY_LABELS[entity]}:</p>
        <p className="font-mono">{template.columns.join(', ')}</p>
        {template.hint && <p className="mt-1 text-neutral-500 italic">{template.hint}</p>}
      </div>
    </div>
  );
};

export default CsvImportPanel;
