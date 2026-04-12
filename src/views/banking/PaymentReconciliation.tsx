import React, { useState, useMemo } from 'react';
import { CheckCircle, AlertCircle, ArrowLeftRight } from 'lucide-react';
import Card from '../../components/UI/Card';
import Button from '../../components/UI/Button';
import Table, { TableColumn } from '../../components/UI/Table';
import StatusTag from '../../components/UI/StatusTag';
import { formatIDR, formatDateID } from '../../utils/formatters';
import {
  usePaymentReconciliation,
  useMatchPayment,
  type UnmatchedPayment,
  type UnmatchedBankTx,
  type ReconciliationMatch,
} from '../../hooks/useBanking';

const PaymentReconciliation: React.FC = () => {
  const { data: reconciliation, isLoading, refetch } = usePaymentReconciliation();
  const matchPayment = useMatchPayment();

  const [selectedPayment, setSelectedPayment] = useState<UnmatchedPayment | null>(null);
  const [selectedBankTx, setSelectedBankTx] = useState<UnmatchedBankTx | null>(null);

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

  const paymentColumns: TableColumn<UnmatchedPayment>[] = [
    { key: 'type', label: 'Type', render: (val) => <StatusTag status={val === 'AR' ? 'AR' : 'AP'} /> },
    { key: 'number', label: 'Number' },
    { key: 'amount', label: 'Amount', render: (val) => formatIDR(Number(val)) },
    { key: 'date', label: 'Date', render: (val) => formatDateID(val as string) },
    { key: 'customerOrVendor', label: 'Customer / Vendor' },
  ];

  const bankTxColumns: TableColumn<UnmatchedBankTx>[] = [
    { key: 'type', label: 'Type', render: (val) => <StatusTag status={val as string} /> },
    { key: 'description', label: 'Description' },
    { key: 'amount', label: 'Amount', render: (val) => formatIDR(Math.abs(Number(val))) },
    { key: 'date', label: 'Date', render: (val) => formatDateID(val as string) },
    { key: 'bankAccount', label: 'Account' },
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
    <div className="container max-w-[1200px] mx-auto">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-bold text-neutral-900">Payment Reconciliation</h1>
        <Button
          text="Refresh"
          variant="secondary"
          size="small"
          onClick={() => refetch()}
          disabled={isLoading}
        />
      </div>

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
    </div>
  );
};

export default PaymentReconciliation;
