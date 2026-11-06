import { formatDateID } from '../../utils/formatters';
import type {
  APAgingRow,
  APAgingSummary,
  APOverdueRow,
  APOverdueSummary,
  APVendorBalanceRow,
  APVendorBalanceSummary,
  AccountLedgerRow,
  AgingRow,
  BalanceSheetMultiSection,
  BalanceSheetMultiSummary,
  BalanceSheetSection,
  BalanceSheetSummary,
  BankHistoryData,
  BankPaymentData,
  BankReceivedData,
  BankReconciliationRow,
  CashFlowRow,
  CashFlowStatementSection,
  CashFlowStatementSummary,
  CashFlowSummary,
  CustomerBalanceRow,
  OverdueRow,
  PLComparativeSection,
  PLComparativeSummary,
  PLSection,
  PLSummary,
  PPh21Row,
  PPh21Summary,
  ReportDefinition,
  SalesByCustomerRow,
  SalesByItemCustomerRow,
  SalesByItemRow,
  SalesHistoryRow,
  SalesMonthlyRow,
  SalesReturnListRow,
  SalesShareItemRow,
  SalesShareRow,
  StatementData,
  StockMovementRow,
  StockValuationData,
  TrialBalanceRow,
  TrialBalanceSummary,
} from './reportTypes';

export const escapeCsvCell = (value: unknown): string => {
  if (value === null || value === undefined) return '';
  return `"${String(value).replace(/"/g, '""')}"`;
};

// ── CSV builders ───────────────────────────────────────────────────────────────

export const buildSalesCsv = (report: ReportDefinition, data: Record<string, unknown>): string => {
  if (report.id === 'by-customer') {
    const rows = data.rows as SalesByCustomerRow[];
    const grand = data.grandTotal as number;
    const totalInvoices = rows.reduce((s, r) => s + r.invoiceCount, 0);
    let csv = 'No,Pelanggan,Jumlah Invoice,Rata-rata per Invoice,Penjualan Neto (termasuk PPN dan nota kredit),Kontribusi (%)\n';
    csv += rows.map((row, i) => [
      i + 1,
      escapeCsvCell(row.customerName),
      row.invoiceCount,
      row.invoiceCount > 0 ? Math.round(row.total / row.invoiceCount) : 0,
      row.total,
      grand > 0 ? ((row.total / grand) * 100).toFixed(1) : '0.0',
    ].join(',')).join('\n');
    csv += `\n,Total,${totalInvoices},${totalInvoices > 0 ? Math.round(grand / totalInvoices) : 0},${grand},100.0`;
    return csv;
  }

  if (report.id === 'by-item') {
    const rows = data.rows as SalesByItemRow[];
    let csv = 'Barang,Qty,Penjualan Bruto (tanpa PPN dan nota kredit)\n';
    csv += rows.map((row) => [
      escapeCsvCell(row.description),
      row.qty,
      row.total,
    ].join(',')).join('\n');
    csv += `\nTotal,,${data.grandTotal as number}`;
    return csv;
  }

  if (report.id === 'history') {
    const rows = data.rows as SalesHistoryRow[];
    let csv = 'No Faktur,Tanggal,Pelanggan,Status,Total\n';
    csv += rows.map((row) => [
      escapeCsvCell(row.number),
      escapeCsvCell(row.issueDate),
      escapeCsvCell(row.customerName),
      escapeCsvCell(row.status),
      row.totalAmount,
    ].join(',')).join('\n');
    return csv;
  }

  if (report.id === 'sales-return-list') {
    const rows = data.rows as SalesReturnListRow[];
    let csv = 'No Retur,Tanggal,Pelanggan,No Faktur Asal,Status,Total\n';
    csv += rows.map((row) => [
      escapeCsvCell(row.number),
      escapeCsvCell(row.returnDate),
      escapeCsvCell(row.customerName),
      escapeCsvCell(row.invoiceNumber),
      escapeCsvCell(row.status),
      row.totalAmount,
    ].join(',')).join('\n');
    csv += `\nTotal,,,,,${data.grandTotal as number}`;
    return csv;
  }

  if (report.id === 'by-item-customer') {
    const rows = data.rows as SalesByItemCustomerRow[];
    let csv = 'Pelanggan,Barang,Qty,Penjualan Bruto (tanpa PPN dan nota kredit)\n';
    csv += rows.map((row) => [
      escapeCsvCell(row.customerName),
      escapeCsvCell(row.description),
      row.qty,
      row.total,
    ].join(',')).join('\n');
    return csv;
  }

  if (report.id === 'monthly-chart') {
    const rows = data.rows as SalesMonthlyRow[];
    let csv = 'Bulan,Penjualan Neto (termasuk PPN dan nota kredit)\n';
    csv += rows.map((row) => [
      escapeCsvCell(row.month),
      row.total,
    ].join(',')).join('\n');
    return csv;
  }

  if (report.id === 'share-by-item') {
    const rows = data.rows as SalesShareItemRow[];
    const grandTotal = data.grandTotal as number;
    let csv = 'Barang,Penjualan Bruto (tanpa PPN dan nota kredit),Porsi (%)\n';
    csv += rows.map((row) => [
      escapeCsvCell(row.description),
      row.total,
      grandTotal > 0 ? ((row.total / grandTotal) * 100).toFixed(1) : 0,
    ].join(',')).join('\n');
    csv += `\nTotal,${grandTotal},100.0`;
    return csv;
  }

  if (report.id === 'share-by-customer') {
    const rows = data.rows as SalesShareRow[];
    const grandTotal = data.grandTotal as number;
    let csv = 'Pelanggan,Total,Porsi (%)\n';
    csv += rows.map((row) => [
      escapeCsvCell(row.customerName),
      row.total,
      grandTotal > 0 ? ((row.total / grandTotal) * 100).toFixed(1) : 0,
    ].join(',')).join('\n');
    return csv;
  }

  return '';
};

// Shared by the customer (AR) and vendor (AP) statement reports.
export const buildStatementCsv = (data: Record<string, unknown>): string => {
  const stmt = data as unknown as StatementData;
  const ag = stmt.summary.aging;
  let csv = 'Tanggal,Tipe,No.,Debit,Kredit,Saldo\n';
  csv += `,Saldo Awal,,,,${stmt.openingBalance}`;
  for (const row of stmt.rows) {
    csv += `\n${[
      escapeCsvCell(formatDateID(row.date)),
      escapeCsvCell(row.type),
      escapeCsvCell(row.number),
      row.debit,
      row.credit,
      row.runningBalance,
    ].join(',')}`;
  }
  csv += `\nTotal,,,${stmt.summary.totalDebits},${stmt.summary.totalCredits},${stmt.summary.closingBalance}`;
  csv += `\nAging Current,,,,,${ag.current}`;
  csv += `\nAging 1-30,,,,,${ag.d1To30}`;
  csv += `\nAging 31-60,,,,,${ag.d31To60}`;
  csv += `\nAging 61-90,,,,,${ag.d61To90}`;
  csv += `\nAging 90+,,,,,${ag.d90Plus}`;
  return csv;
};

export const buildArCsv = (report: ReportDefinition, data: Record<string, unknown>): string => {
  if (report.id === 'statement') return buildStatementCsv(data);
  const summary = (data.summary || {}) as Record<string, number>;

  if (report.id === 'aging') {
    const rows = data.rows as AgingRow[];
    let csv = 'No Faktur,Tanggal Faktur,Jatuh Tempo,Pelanggan,Hari Lewat Jatuh Tempo,Nilai Faktur,Terlunasi,Saldo,Current,1-30,31-60,61-90,90+\n';
    csv += rows.map((row) => [
      escapeCsvCell(row.invoiceNumber),
      escapeCsvCell(row.invoiceDate),
      escapeCsvCell(row.dueDate),
      escapeCsvCell(row.customerName),
      row.daysOverdue,
      row.originalAmount,
      row.clearedAmount,
      row.balance,
      row.current,
      row.d1To30,
      row.d31To60,
      row.d61To90,
      row.d90Plus,
    ].join(',')).join('\n');
    csv += `\nTotal,,,,,,,${summary.totalOutstanding || 0},${summary.current || 0},${summary.d1To30 || 0},${summary.d31To60 || 0},${summary.d61To90 || 0},${summary.d90Plus || 0}`;
    return csv;
  }

  if (report.id === 'customer-balance') {
    const rows = data.rows as CustomerBalanceRow[];
    let csv = 'Kode Pelanggan,Pelanggan,Total Ditagih,Total Dibayar,Saldo Piutang\n';
    csv += rows.map((row) => [
      escapeCsvCell(row.customerCode || ''),
      escapeCsvCell(row.customerName),
      row.invoicedAmount,
      row.paidAmount,
      row.outstandingAmount,
    ].join(',')).join('\n');
    csv += `\nTotal,,${summary.totalInvoiced || 0},${summary.totalPaid || 0},${summary.totalOutstanding || 0}`;
    return csv;
  }

  if (report.id === 'overdue-list') {
    const rows = data.rows as OverdueRow[];
    let csv = 'No Faktur,Jatuh Tempo,Pelanggan,Hari Lewat Jatuh Tempo,Status,Saldo\n';
    csv += rows.map((row) => [
      escapeCsvCell(row.invoiceNumber),
      escapeCsvCell(row.dueDate),
      escapeCsvCell(row.customerName),
      row.daysOverdue,
      escapeCsvCell(row.status),
      row.balance,
    ].join(',')).join('\n');
    csv += `\nTotal Invoice Overdue,${summary.overdueInvoiceCount || 0},,,,${summary.overdueAmount || 0}`;
    return csv;
  }

  return '';
};

export const buildGlCsv = (report: ReportDefinition, data: Record<string, unknown>): string => {
  if (report.id === 'trial-balance') {
    const rows = data.rows as TrialBalanceRow[];
    const summary = data.summary as TrialBalanceSummary;
    let csv = 'Account Code,Account Name,Type,Total Debit,Total Credit,Ending Debit,Ending Credit\n';
    csv += rows.map((row) => [
      escapeCsvCell(row.accountCode),
      escapeCsvCell(row.accountName),
      escapeCsvCell(row.accountType),
      row.totalDebit,
      row.totalCredit,
      row.endingDebit,
      row.endingCredit,
    ].join(',')).join('\n');
    csv += `\nTotal,,,${summary.totalDebit || 0},${summary.totalCredit || 0},${summary.endingDebit || 0},${summary.endingCredit || 0}`;
    return csv;
  }

  if (report.id === 'profit-loss') {
    const sections = (data.sections || []) as PLSection[];
    const summary = data.summary as PLSummary;
    let csv = 'Section,Account Code,Account Name,Amount\n';
    csv += sections.flatMap((section) => (
      section.rows.map((row) => [
        escapeCsvCell(section.label),
        escapeCsvCell(row.accountCode),
        escapeCsvCell(row.accountName),
        row.amount,
      ].join(','))
    )).join('\n');
    csv += `\nTotal Revenue,,,${summary.totalRevenue || 0}`;
    csv += `\nTotal Expenses,,,${summary.totalExpense || 0}`;
    csv += `\nNet Income,,,${summary.netIncome || 0}`;
    return csv;
  }

  if (report.id === 'balance-sheet') {
    const sections = (data.sections || []) as BalanceSheetSection[];
    const summary = data.summary as BalanceSheetSummary;
    let csv = 'Section,Account Code,Account Name,Amount\n';
    csv += sections.flatMap((section) => (
      section.rows.map((row) => [
        escapeCsvCell(section.label),
        escapeCsvCell(row.accountCode),
        escapeCsvCell(row.accountName),
        row.amount,
      ].join(','))
    )).join('\n');
    csv += `\nTotal Assets,,,${summary.totalAssets || 0}`;
    csv += `\nTotal Liabilities,,,${summary.totalLiabilities || 0}`;
    csv += `\nTotal Equity,,,${summary.totalEquity || 0}`;
    csv += `\nTotal Liabilities + Equity,,,${summary.totalLiabilitiesAndEquity || 0}`;
    return csv;
  }

  if (report.id === 'balance-sheet-multi-period') {
    const sections = (data.sections || []) as BalanceSheetMultiSection[];
    const summary = data.summary as BalanceSheetMultiSummary;
    let csv = 'Section,Account Code,Account Name,Current Period,Compare Period,Variance\n';
    csv += sections.flatMap((section) => (
      section.rows.map((row) => [
        escapeCsvCell(section.label),
        escapeCsvCell(row.accountCode),
        escapeCsvCell(row.accountName),
        row.currentAmount,
        row.compareAmount,
        row.variance,
      ].join(','))
    )).join('\n');
    csv += `\nTotal Assets,,,${summary.current.totalAssets || 0},${summary.compare.totalAssets || 0},${summary.variance.totalAssets || 0}`;
    csv += `\nTotal Liabilities,,,${summary.current.totalLiabilities || 0},${summary.compare.totalLiabilities || 0},${summary.variance.totalLiabilities || 0}`;
    csv += `\nTotal Equity,,,${summary.current.totalEquity || 0},${summary.compare.totalEquity || 0},${summary.variance.totalEquity || 0}`;
    return csv;
  }

  if (report.id === 'profit-loss-multi-period') {
    const sections = (data.sections || []) as PLComparativeSection[];
    const summary = data.summary as PLComparativeSummary;
    let csv = 'Section,Code,Account,Current Period,Compare Period,Variance (Rp),Variance (%)\n';
    csv += sections.flatMap((section) => (
      section.rows.map((row) => [
        escapeCsvCell(section.label),
        escapeCsvCell(row.code),
        escapeCsvCell(row.name),
        row.currentAmount,
        row.compareAmount,
        row.variance,
        row.variancePct.toFixed(1),
      ].join(','))
    )).join('\n');
    csv += `\nTotal Revenue,,,${summary.currentRevenue || 0},${summary.compareRevenue || 0},${summary.revenueVariance || 0},`;
    csv += `\nTotal Expenses,,,${summary.currentExpenses || 0},${summary.compareExpenses || 0},${summary.expensesVariance || 0},`;
    csv += `\nNet Income,,,${summary.currentNetIncome || 0},${summary.compareNetIncome || 0},${summary.netIncomeVariance || 0},${(summary.netIncomeVariancePct || 0).toFixed(1)}`;
    return csv;
  }

  if (report.id === 'account-ledger') {
    const rows = (data.rows || []) as AccountLedgerRow[];
    const accountCode = data.accountCode as string || '';
    const accountName = data.accountName as string || '';
    const openingBalance = data.openingBalance as number || 0;
    const closingBalance = data.closingBalance as number || 0;
    let csv = `Account: ${accountCode} - ${accountName}\n`;
    csv += 'Date,Journal No.,Description,Debit,Credit,Balance\n';
    csv += `Opening Balance,,,,,${openingBalance}\n`;
    csv += rows.map((row) => [
      escapeCsvCell(row.date),
      escapeCsvCell(row.entryNo),
      escapeCsvCell(row.description),
      row.debit, row.credit, row.runningBalance,
    ].join(',')).join('\n');
    csv += `\nClosing Balance,,,,,${closingBalance}`;
    return csv;
  }

  if (report.id === 'cash-flow-statement') {
    const sections = (data.sections || []) as CashFlowStatementSection[];
    const summary = data.summary as CashFlowStatementSummary;
    let csv = 'Section,Code,Account,Amount\n';
    csv += sections.flatMap((section) => [
      ...section.rows.map((row) => [
        escapeCsvCell(section.label),
        escapeCsvCell(row.code),
        escapeCsvCell(row.name),
        row.amount,
      ].join(',')),
      `Subtotal ${section.label},,,${section.subtotal}`,
    ]).join('\n');
    csv += `\nNet Change in Cash,,,${summary.netCashChange || 0}`;
    csv += `\nBeginning Cash,,,${summary.beginningCash || 0}`;
    if (Math.abs(summary.reconciliationDifference || 0) > 0.005) {
      csv += `\nUnexplained Reconciling Difference,,,${summary.reconciliationDifference || 0}`;
    }
    csv += `\nEnding Cash,,,${summary.endingCash || 0}`;
    return csv;
  }

  return '';
};

// ── Main component ─────────────────────────────────────────────────────────────


export const buildApCsv = (report: ReportDefinition, data: Record<string, unknown>): string => {
  if (report.id === 'ap-statement') return buildStatementCsv(data);
  if (report.id === 'ap-aging') {
    const rows = (data.rows || []) as APAgingRow[];
    const summary = (data.summary || {}) as APAgingSummary;
    let csv = 'Bill No.,Vendor,Bill Date,Due Date,Days Overdue,Current,1-30,31-60,61-90,90+,Balance\n';
    csv += rows.map((row) => [
      escapeCsvCell(row.id),
      escapeCsvCell(row.vendorName),
      escapeCsvCell(row.billDate),
      escapeCsvCell(row.dueDate),
      row.daysOverdue,
      row.current, row.d1_30, row.d31_60, row.d61_90, row.d90plus, row.balance,
    ].join(',')).join('\n');
    csv += `\nTotal,,,,, ${summary.current || 0},${summary.d1_30 || 0},${summary.d31_60 || 0},${summary.d61_90 || 0},${summary.d90plus || 0},${summary.balance || 0}`;
    return csv;
  }

  if (report.id === 'ap-vendor-balance') {
    const rows = (data.rows || []) as APVendorBalanceRow[];
    const summary = (data.summary || {}) as APVendorBalanceSummary;
    let csv = 'Kode Vendor,Vendor,Total Ditagih,Total Dibayar,Saldo Utang\n';
    csv += rows.map((row) => [
      escapeCsvCell(row.vendorCode),
      escapeCsvCell(row.vendorName),
      row.billedAmount, row.paidAmount, row.outstandingAmount,
    ].join(',')).join('\n');
    csv += `\nTotal (${summary.vendorCount || 0} vendor),,${summary.totalBilled || 0},${summary.totalPaid || 0},${summary.totalOutstanding || 0}`;
    return csv;
  }

  if (report.id === 'ap-overdue-list') {
    const rows = (data.rows || []) as APOverdueRow[];
    const summary = (data.summary || {}) as APOverdueSummary;
    let csv = 'No Tagihan,Jatuh Tempo,Vendor,Hari Lewat,Status,Saldo\n';
    csv += rows.map((row) => [
      escapeCsvCell(row.billNumber),
      escapeCsvCell(row.dueDate),
      escapeCsvCell(row.vendorName),
      row.daysOverdue,
      escapeCsvCell(row.status),
      row.balance,
    ].join(',')).join('\n');
    csv += `\nTotal Tagihan Overdue,${summary.overdueBillCount || 0},,,,${summary.overdueAmount || 0}`;
    return csv;
  }

  return '';
};

export const buildBankingCsv = (report: ReportDefinition, data: Record<string, unknown>): string => {
  if (report.id === 'cash-flow') {
    const rows = (data.rows || []) as CashFlowRow[];
    const summary = (data.summary || {}) as CashFlowSummary;
    let csv = 'Bank Account,Date,Inflow,Outflow,Net\n';
    csv += rows.map((row) => [
      escapeCsvCell(row.bankAccountName),
      escapeCsvCell(row.date),
      row.inflow, row.outflow, row.net,
    ].join(',')).join('\n');
    csv += `\nTotal,,${summary.totalInflow || 0},${summary.totalOutflow || 0},${summary.totalNet || 0}`;
    return csv;
  }
  if (report.id === 'bank-reconciliation') {
    const rows = (data.rows || []) as BankReconciliationRow[];
    let csv = 'Account,Code,Bank,Book Balance,Statement Balance,Variance,Matched,Unmatched,Unmatched Amount,Last Statement\n';
    csv += rows.map((row) => [
      escapeCsvCell(row.accountName),
      escapeCsvCell(row.accountCode ?? ''),
      escapeCsvCell(row.bankName ?? ''),
      row.bookBalance,
      row.statementEndBalance ?? '',
      row.variance ?? '',
      row.matchedCount,
      row.unmatchedCount,
      row.unmatchedAmount,
      escapeCsvCell(row.lastStatementDate ? formatDateID(row.lastStatementDate) : ''),
    ].join(',')).join('\n');
    return csv;
  }
  if (report.id === 'bank-history') {
    const hist = data as unknown as BankHistoryData;
    let csv = '';
    for (const bank of hist.banks || []) {
      csv += `${escapeCsvCell(bank.bankAccountName)}\n`;
      csv += 'Tanggal,No. Jurnal,Keterangan,Lawan Transaksi,Masuk,Keluar,Saldo\n';
      csv += `,,Saldo Awal,,,,${bank.openingBalance}\n`;
      csv += (bank.rows || []).map((row) => [
        escapeCsvCell(formatDateID(row.date)),
        escapeCsvCell(row.journalEntryNo ?? row.txnNumber ?? ''),
        escapeCsvCell(row.description),
        escapeCsvCell(row.counterparty),
        row.moneyIn,
        row.moneyOut,
        row.runningBalance,
      ].join(',')).join('\n');
      csv += `\nTotal,,,,${bank.totalIn},${bank.totalOut},${bank.closingBalance}\n\n`;
    }
    return csv.trimEnd();
  }

  if (report.id === 'bank-received' || report.id === 'bank-payment') {
    const isReceived = report.id === 'bank-received';
    const detail = data as unknown as (BankReceivedData | BankPaymentData);
    const rows = detail.rows || [];
    let csv = `Tanggal,No. Jurnal,${isReceived ? 'Dari' : 'Kepada'},Keterangan,Jumlah\n`;
    csv += rows.map((row) => [
      escapeCsvCell(formatDateID(row.date)),
      escapeCsvCell(row.journalEntryNo ?? row.txnNumber ?? ''),
      escapeCsvCell(isReceived ? (row.from ?? '') : (row.payee ?? '')),
      escapeCsvCell(row.description),
      row.amount,
    ].join(',')).join('\n');
    const total = isReceived ? (detail as BankReceivedData).summary.totalReceived : (detail as BankPaymentData).summary.totalPaid;
    csv += `\nTotal (${rows.length} transaksi),,,,${total}`;
    return csv;
  }
  return '';
};

export const buildInventoryCsv = (report: ReportDefinition, data: Record<string, unknown>, categoryNameById: ReadonlyMap<string, string>): string => {
  if (report.id === 'stock-movement') {
    const rows = (data.rows || []) as StockMovementRow[];
    let csv = 'SKU,Item Name,Opening Balance,Total In,Total Out,Closing Balance\n';
    csv += rows.map((row) => [
      escapeCsvCell(row.sku),
      escapeCsvCell(row.itemName),
      row.openingBalance, row.totalIn, row.totalOut, row.closingBalance,
    ].join(',')).join('\n');
    return csv;
  }

  if (report.id === 'stock-valuation') {
    const valData = data as unknown as StockValuationData;
    const rows = valData.items || [];
    let csv = 'SKU,Item Name,Category,Qty on Hand,Avg Unit Cost,Total Value\n';
    csv += rows.map((row) => [
      escapeCsvCell(row.sku),
      escapeCsvCell(row.name),
      escapeCsvCell((row.categoryId && categoryNameById.get(row.categoryId)) || ''),
      row.totalQty,
      row.avgCost,
      row.totalValue,
    ].join(',')).join('\n');
    csv += `\nTotal,,,,,${valData.summary?.totalValue ?? 0}`;
    return csv;
  }
  return '';
};

export const buildHrCsv = (report: ReportDefinition, data: Record<string, unknown>): string => {
  if (report.id === 'pph21-summary') {
    const rows = (data.rows || []) as PPh21Row[];
    const summary = (data.summary || {}) as PPh21Summary;
    let csv = 'No,Employee ID,Name,NPWP,Gross Pay,PPh 21,BPJS Kes (EE),BPJS Kes (ER),BPJS JHT (EE),BPJS JHT (ER),BPJS JP (EE),BPJS JP (ER),JKK (ER),JKM (ER),Total Deductions,Net Pay\n';
    csv += rows.map((row, i) => [
      i + 1,
      escapeCsvCell(row.employeeNo),
      escapeCsvCell(row.employeeName),
      escapeCsvCell(row.npwp),
      row.grossPay, row.pph21,
      row.bpjsKesEmployee, row.bpjsKesEmployer,
      row.bpjsJhtEmployee, row.bpjsJhtEmployer,
      row.bpjsJpEmployee, row.bpjsJpEmployer,
      row.bpjsJkkEmployer, row.bpjsJkmEmployer,
      row.totalDeductions, row.netPay,
    ].join(',')).join('\n');
    csv += `\nTotal (${summary.employeeCount || 0} karyawan),,,, ${summary.totalGrossPay || 0},${summary.totalPph21 || 0},${summary.totalBpjsEmployee || 0},,${summary.totalBpjsEmployer || 0},,,,,,${summary.totalNetPay || 0}`;
    return csv;
  }
  return '';
};
