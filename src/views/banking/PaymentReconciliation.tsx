import React, { useState, useMemo } from 'react';
import { CheckCircle, AlertCircle, ArrowLeftRight, Upload, Zap } from 'lucide-react';
import Card from '../../components/UI/Card';
import Button from '../../components/UI/Button';
import Modal from '../../components/UI/Modal';
import Table, { TableColumn } from '../../components/UI/Table';
import StatusTag from '../../components/UI/StatusTag';
import SearchableSelect from '../../components/UI/SearchableSelect';
import PageHeader from '../../components/Layout/PageHeader';
import { formatIDR, formatDateID } from '../../utils/formatters';
import { useModulePermissions } from '../../hooks/useModulePermissions';
import {
  usePaymentReconciliation,
  useMatchPayment,
  useBankAccounts,
  useBankTransactions,
  useBankStatements,
  useBankStatementLines,
  useImportBankStatement,
  useAutoMatch,
  useManualMatch,
  type UnmatchedPayment,
  type UnmatchedBankTx,
  type ReconciliationMatch,
  type BankStatement,
  type BankStatementLine,
} from '../../hooks/useBanking';
import type { BankAccount, BankTransaction } from '../../types';

const PaymentReconciliation: React.FC = () => {
  const { canCreate } = useModulePermissions('banking');
  const { data: reconciliation, isLoading, refetch } = usePaymentReconciliation();
  const matchPayment = useMatchPayment();

  const [selectedPayment, setSelectedPayment] = useState<UnmatchedPayment | null>(null);
  const [selectedBankTx, setSelectedBankTx] = useState<UnmatchedBankTx | null>(null);

  // ── Bank statement import & matching state ────────────────────────────────
  const { data: bankAccounts = [] } = useBankAccounts();
  const { data: statements = [] } = useBankStatements();
  const [activeStatementId, setActiveStatementId] = useState('');
  const activeStatement = (statements as BankStatement[]).find((s) => s.id === activeStatementId) || null;
  const { data: statementLines = [], isLoading: linesLoading } = useBankStatementLines(activeStatementId || undefined);

  const [importModalOpen, setImportModalOpen] = useState(false);
  const [importAccountId, setImportAccountId] = useState('');
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importError, setImportError] = useState('');

  const importStatement = useImportBankStatement();
  const autoMatch = useAutoMatch(activeStatementId);
  const manualMatch = useManualMatch();

  // Unmatched bank transactions for the active statement's account — manual match candidates
  const txnFilters = useMemo(() => (
    activeStatement ? { bankAccountId: activeStatement.bankAccountId } : {}
  ), [activeStatement]);
  const { data: txnResult } = useBankTransactions(txnFilters);
  const unmatchedTxns = useMemo(
    () => ((txnResult?.data ?? []) as BankTransaction[]).filter((t) => t.status === 'Unmatched'),
    [txnResult]
  );

  const matchOptionsForLine = (line: BankStatementLine) => {
    // Same-amount transactions first — they're the likely matches
    const sorted = [...unmatchedTxns].sort((a, b) => {
      const aExact = Math.abs(a.amount - line.amount) < 0.01 ? 0 : 1;
      const bExact = Math.abs(b.amount - line.amount) < 0.01 ? 0 : 1;
      if (aExact !== bExact) return aExact - bExact;
      return a.date < b.date ? 1 : -1;
    });
    return sorted.map((t) => ({
      value: t.id,
      label: t.description || t.id,
      subLabel: `${formatDateID(t.date)} • ${formatIDR(t.amount)}`,
    }));
  };

  const summary = reconciliation?.summary ?? { totalMatched: 0, totalUnmatched: 0, totalUnmatchedBankTx: 0, matchRate: 0 };
  const matched = useMemo(() => reconciliation?.matched ?? [], [reconciliation]);
  const unmatchedPayments = useMemo(() => reconciliation?.unmatchedPayments ?? [], [reconciliation]);
  const unmatchedBankTx = useMemo(() => reconciliation?.unmatchedBankTx ?? [], [reconciliation]);

  const canMatch = selectedPayment && selectedBankTx;

  const handleMatch = async () => {
    if (!selectedPayment || !selectedBankTx) return;
    try {
      await matchPayment.mutateAsync({
        paymentType: selectedPayment.type,
        paymentId: selectedPayment.id,
        bankTransactionId: selectedBankTx.id,
      });
      setSelectedPayment(null);
      setSelectedBankTx(null);
      refetch();
    } catch (e: any) {
      window.alert(e.message || 'Failed to match');
    }
  };

  const statementLineColumns: TableColumn<Record<string, unknown>>[] = [
    { key: 'date', label: 'Date', render: (val) => formatDateID(val as string) },
    { key: 'description', label: 'Description' },
    {
      key: 'amount',
      label: 'Amount',
      align: 'right' as const,
      render: (val) => {
        const v = val as number;
        return (
          <span className={v >= 0 ? 'banking-amount-positive' : 'banking-amount-negative'}>
            {v >= 0 ? '+' : ''}{formatIDR(v)}
          </span>
        );
      },
    },
    {
      key: 'status',
      label: 'Status',
      render: (val) => <StatusTag status={(val as string) === 'Matched' ? 'Success' : 'Warning'} label={val as string} />,
    },
    {
      key: 'match',
      label: 'Match To',
      render: (_, row) => {
        const line = row as unknown as BankStatementLine;
        if (line.status === 'Matched') {
          return <span className="text-xs text-neutral-400">Matched{line.matchedTxnId ? ` — ${line.matchedTxnId}` : ''}</span>;
        }
        return (
          <SearchableSelect
            className="!mb-0 w-[260px]"
            options={matchOptionsForLine(line)}
            value=""
            placeholder="Match to transaction..."
            disabled={!canCreate || manualMatch.isPending}
            onChange={(txnId) => {
              if (txnId) manualMatch.mutate({ statementLineId: line.id, txnId });
            }}
          />
        );
      },
    },
  ];

  const matchedColumns: TableColumn<ReconciliationMatch>[] = [
    { key: 'paymentType', label: 'Type', render: (val) => <StatusTag status={val as string} /> },
    { key: 'paymentNumber', label: 'Payment #' },
    { key: 'paymentAmount', label: 'Payment Amt', render: (val) => formatIDR(Number(val)) },
    { key: 'paymentDate', label: 'Pay Date', render: (val) => formatDateID(val as string) },
    { key: 'bankTxnDescription', label: 'Bank Description' },
    { key: 'bankTxnAmount', label: 'Bank Amt', render: (val) => formatIDR(Number(val)) },
    { key: 'bankTxnDate', label: 'Bank Date', render: (val) => formatDateID(val as string) },
    { key: 'customerOrVendor', label: 'Name' },
  ];

  return (
    <div className="container banking-module container-full-width">
      <PageHeader
        title="Payment Reconciliation"
        subtitle="Match payments and imported bank statements against bank transactions."
        actions={
          <Button
            text="Refresh"
            variant="secondary"
            size="small"
            onClick={() => refetch()}
            disabled={isLoading}
          />
        }
      />

      {/* Summary cards */}
      <div className="grid grid-cols-4 gap-4 mb-6">
        <Card>
          <div className="flex items-center gap-3">
            <div className="p-2 bg-success-100 rounded-lg">
              <CheckCircle size={20} className="text-success-600" />
            </div>
            <div>
              <div className="text-xs text-neutral-500">Matched</div>
              <div className="text-lg font-bold text-neutral-900">{summary.totalMatched}</div>
            </div>
          </div>
        </Card>
        <Card>
          <div className="flex items-center gap-3">
            <div className="p-2 bg-warning-100 rounded-lg">
              <AlertCircle size={20} className="text-warning-600" />
            </div>
            <div>
              <div className="text-xs text-neutral-500">Unmatched Payments</div>
              <div className="text-lg font-bold text-neutral-900">{summary.totalUnmatched}</div>
            </div>
          </div>
        </Card>
        <Card>
          <div className="flex items-center gap-3">
            <div className="p-2 bg-danger-100 rounded-lg">
              <AlertCircle size={20} className="text-danger-600" />
            </div>
            <div>
              <div className="text-xs text-neutral-500">Unmatched Bank Tx</div>
              <div className="text-lg font-bold text-neutral-900">{summary.totalUnmatchedBankTx}</div>
            </div>
          </div>
        </Card>
        <Card>
          <div className="flex items-center gap-3">
            <div className="p-2 bg-primary-100 rounded-lg">
              <ArrowLeftRight size={20} className="text-primary-600" />
            </div>
            <div>
              <div className="text-xs text-neutral-500">Match Rate</div>
              <div className="text-lg font-bold text-neutral-900">{summary.matchRate}%</div>
            </div>
          </div>
        </Card>
      </div>

      {/* ── Bank Statement Import & Matching ──────────────────────────────── */}
      <div className="mb-6">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-base font-semibold text-neutral-800">Bank Statements</h2>
          <div className="flex items-center gap-2">
            {(statements as BankStatement[]).length > 0 && (
              <select
                className="h-9 px-3 rounded-md border border-neutral-300 bg-neutral-0 text-sm focus:border-primary-500 focus:outline-0"
                value={activeStatementId}
                onChange={(e) => setActiveStatementId(e.target.value)}
              >
                <option value="">Select imported statement</option>
                {(statements as BankStatement[]).map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.fileName || s.id} {s.importedAt ? `(${formatDateID(s.importedAt.slice(0, 10))})` : ''}
                  </option>
                ))}
              </select>
            )}
            {activeStatementId && (
              <Button
                text="Auto-match"
                variant="primary"
                size="small"
                icon={<Zap size={14} />}
                disabled={autoMatch.isPending || !canCreate}
                onClick={() => autoMatch.mutate()}
              />
            )}
            <Button
              text="Import Statement"
              variant="secondary"
              size="small"
              icon={<Upload size={16} />}
              disabled={!canCreate}
              onClick={() => setImportModalOpen(true)}
            />
          </div>
        </div>

        {activeStatement ? (
          <Card padding={false}>
            <Table
              columns={statementLineColumns}
              data={statementLines as unknown as Record<string, unknown>[]}
              showCount
              countLabel="statement lines"
              isLoading={linesLoading}
              loadingLabel="Loading statement lines..."
            />
          </Card>
        ) : (
          <Card padding>
            <div className="text-sm text-neutral-500 text-center py-4">
              {(statements as BankStatement[]).length > 0
                ? 'Select an imported statement above to review and match its lines.'
                : 'No statements imported yet. Import a bank statement (.csv, .ofx, .qfx) to start matching.'}
            </div>
          </Card>
        )}
      </div>

      {isLoading ? (
        <div className="p-8 text-center text-neutral-500">Loading reconciliation data...</div>
      ) : (
        <>
          {/* Two-panel layout for manual matching */}
          {(unmatchedPayments.length > 0 || unmatchedBankTx.length > 0) && (
            <div className="mb-6">
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-base font-semibold text-neutral-800">Manual Matching</h2>
                {canMatch && (
                  <Button
                    text={matchPayment.isPending ? 'Matching...' : 'Match Selected'}
                    variant="primary"
                    size="small"
                    icon={<ArrowLeftRight size={14} />}
                    onClick={handleMatch}
                    disabled={matchPayment.isPending}
                  />
                )}
              </div>

              <div className="grid grid-cols-2 gap-4">
                {/* Left: Unmatched Payments */}
                <Card title="Unmatched Payments" padding={false}>
                  {unmatchedPayments.length === 0 ? (
                    <div className="p-6 text-center text-neutral-500 text-sm">All payments matched</div>
                  ) : (
                    <div className="max-h-[400px] overflow-auto">
                      {unmatchedPayments.map((p) => (
                        <button
                          key={`${p.type}-${p.id}`}
                          type="button"
                          className={`w-full text-left px-4 py-3 border-b border-neutral-100 hover:bg-primary-50/50 transition ${
                            selectedPayment?.id === p.id ? 'bg-primary-50 border-l-2 border-l-primary-500' : ''
                          }`}
                          onClick={() => setSelectedPayment(p)}
                        >
                          <div className="flex items-center justify-between">
                            <div>
                              <div className="text-sm font-medium text-neutral-800">{p.number}</div>
                              <div className="text-xs text-neutral-500">{p.customerOrVendor} - {formatDateID(p.date)}</div>
                            </div>
                            <div className="text-right">
                              <div className="text-sm font-semibold">{formatIDR(p.amount)}</div>
                              <StatusTag status={p.type} />
                            </div>
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                </Card>

                {/* Right: Unmatched Bank Transactions */}
                <Card title="Unmatched Bank Transactions" padding={false}>
                  {unmatchedBankTx.length === 0 ? (
                    <div className="p-6 text-center text-neutral-500 text-sm">All bank transactions matched</div>
                  ) : (
                    <div className="max-h-[400px] overflow-auto">
                      {unmatchedBankTx.map((tx) => (
                        <button
                          key={tx.id}
                          type="button"
                          className={`w-full text-left px-4 py-3 border-b border-neutral-100 hover:bg-primary-50/50 transition ${
                            selectedBankTx?.id === tx.id ? 'bg-primary-50 border-l-2 border-l-primary-500' : ''
                          }`}
                          onClick={() => setSelectedBankTx(tx)}
                        >
                          <div className="flex items-center justify-between">
                            <div>
                              <div className="text-sm font-medium text-neutral-800">{tx.description}</div>
                              <div className="text-xs text-neutral-500">{tx.bankAccount} - {formatDateID(tx.date)}</div>
                            </div>
                            <div className="text-right">
                              <div className="text-sm font-semibold">{formatIDR(Math.abs(tx.amount))}</div>
                              <StatusTag status={tx.type} />
                            </div>
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                </Card>
              </div>
            </div>
          )}

          {/* Matched section */}
          {matched.length > 0 && (
            <div>
              <h2 className="text-base font-semibold text-neutral-800 mb-3">Matched Pairs ({matched.length})</h2>
              <Card padding={false}>
                <Table columns={matchedColumns} data={matched} />
              </Card>
            </div>
          )}
        </>
      )}

      {/* ── Import modal ──────────────────────────────────────────────────── */}
      <Modal
        isOpen={importModalOpen}
        onClose={() => { setImportModalOpen(false); setImportError(''); setImportFile(null); }}
        title="Import Bank Statement"
        size="sm"
      >
        <div className="space-y-4">
          {importError && (
            <div className="rounded-lg border border-danger-200 bg-danger-50 px-3 py-2 text-sm text-danger-700">
              {importError}
            </div>
          )}
          <div>
            <label className="form-label">Bank Account</label>
            <select
              className="block w-full px-3 text-sm text-neutral-900 bg-neutral-0 border border-neutral-300 rounded-md h-10 focus:border-primary-500 focus:outline-0"
              value={importAccountId}
              onChange={(e) => setImportAccountId(e.target.value)}
            >
              <option value="">Select bank account</option>
              {(bankAccounts as BankAccount[]).map((acc) => (
                <option key={acc.id} value={acc.id}>{acc.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="form-label">Statement File</label>
            <input
              type="file"
              accept=".csv,.ofx,.qfx"
              className="block w-full text-sm text-neutral-700 file:mr-3 file:py-1.5 file:px-3 file:rounded-md file:border-0 file:text-sm file:font-medium file:bg-primary-50 file:text-primary-700 hover:file:bg-primary-100"
              onChange={(e) => setImportFile(e.target.files?.[0] ?? null)}
            />
            <div className="mt-1 text-xs text-neutral-500">Accepted: .csv, .ofx, .qfx</div>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button text="Cancel" variant="secondary" onClick={() => { setImportModalOpen(false); setImportError(''); }} />
            <Button
              text={importStatement.isPending ? 'Importing...' : 'Import'}
              variant="primary"
              disabled={importStatement.isPending}
              onClick={async () => {
                if (!importFile) { setImportError('Please select a file.'); return; }
                if (!importAccountId) { setImportError('Please select a bank account.'); return; }
                setImportError('');
                const fd = new FormData();
                fd.append('file', importFile);
                fd.append('bankAccountId', importAccountId);
                try {
                  const result = await importStatement.mutateAsync(fd);
                  setActiveStatementId(result.id);
                  setImportModalOpen(false);
                  setImportFile(null);
                } catch (err) {
                  setImportError((err as Error)?.message ?? 'Import failed.');
                }
              }}
            />
          </div>
        </div>
      </Modal>
    </div>
  );
};

export default PaymentReconciliation;
