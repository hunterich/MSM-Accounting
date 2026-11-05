import React from 'react';
import { formatIDR } from '../../utils/formatters';
import { renderEmptyReport, type ReportResultProps } from './reportResultHelpers';
import type { PPh21Row, PPh21Summary } from './reportTypes';

export default function HrReportResult({ activeReport }: ReportResultProps): React.ReactNode {
  const { report, data } = activeReport;
  if (report.id === 'pph21-summary') {
    const pphData = data as { rows: PPh21Row[]; summary: PPh21Summary };
    const pphRows = pphData.rows || [];
    const pphSummary = pphData.summary || {} as PPh21Summary;
    if (!pphRows.length) return renderEmptyReport('Tidak ada data PPh 21 untuk periode yang dipilih.');

    return (
      <div>
        <div className="grid grid-cols-3 gap-3 mb-4 print:grid-cols-3">
          <div className="rounded-lg border border-neutral-200 bg-neutral-50 px-4 py-3 text-center">
            <div className="text-xs text-neutral-500">Jumlah Karyawan</div>
            <div className="text-lg font-bold text-neutral-900">{pphSummary.employeeCount || 0}</div>
          </div>
          <div className="rounded-lg border border-neutral-200 bg-neutral-50 px-4 py-3 text-center">
            <div className="text-xs text-neutral-500">Total Gaji Kotor</div>
            <div className="text-lg font-bold text-neutral-900">{formatIDR(pphSummary.totalGrossPay || 0)}</div>
          </div>
          <div className="rounded-lg border border-neutral-200 bg-neutral-50 px-4 py-3 text-center">
            <div className="text-xs text-neutral-500">Total Gaji Bersih</div>
            <div className="text-lg font-bold text-success-700">{formatIDR(pphSummary.totalNetPay || 0)}</div>
          </div>
        </div>
        <div className="grid grid-cols-3 gap-3 mb-4 print:grid-cols-3">
          <div className="rounded-lg border border-neutral-200 bg-neutral-50 px-4 py-3 text-center">
            <div className="text-xs text-neutral-500">Total PPh 21</div>
            <div className="text-lg font-bold text-danger-600">{formatIDR(pphSummary.totalPph21 || 0)}</div>
          </div>
          <div className="rounded-lg border border-neutral-200 bg-neutral-50 px-4 py-3 text-center">
            <div className="text-xs text-neutral-500">Total BPJS (Karyawan)</div>
            <div className="text-lg font-bold text-neutral-900">{formatIDR(pphSummary.totalBpjsEmployee || 0)}</div>
          </div>
          <div className="rounded-lg border border-neutral-200 bg-neutral-50 px-4 py-3 text-center">
            <div className="text-xs text-neutral-500">Total BPJS (Pemberi Kerja)</div>
            <div className="text-lg font-bold text-neutral-900">{formatIDR(pphSummary.totalBpjsEmployer || 0)}</div>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm min-w-[1200px]">
            <thead>
              <tr className="bg-blue-50">
                <th className="p-2 text-center font-semibold border border-neutral-300 w-[40px]">No</th>
                <th className="p-2 text-left font-semibold border border-neutral-300 w-[100px]">ID Karyawan</th>
                <th className="p-2 text-left font-semibold border border-neutral-300">Nama</th>
                <th className="p-2 text-left font-semibold border border-neutral-300 w-[140px]">NPWP</th>
                <th className="p-2 text-right font-semibold border border-neutral-300">Gaji Kotor</th>
                <th className="p-2 text-right font-semibold border border-neutral-300">PPh 21</th>
                <th className="p-2 text-right font-semibold border border-neutral-300">BPJS Kes EE</th>
                <th className="p-2 text-right font-semibold border border-neutral-300">BPJS Kes ER</th>
                <th className="p-2 text-right font-semibold border border-neutral-300">JHT EE</th>
                <th className="p-2 text-right font-semibold border border-neutral-300">JHT ER</th>
                <th className="p-2 text-right font-semibold border border-neutral-300">JP EE</th>
                <th className="p-2 text-right font-semibold border border-neutral-300">JP ER</th>
                <th className="p-2 text-right font-semibold border border-neutral-300">JKK ER</th>
                <th className="p-2 text-right font-semibold border border-neutral-300">JKM ER</th>
                <th className="p-2 text-right font-semibold border border-neutral-300">Gaji Bersih</th>
              </tr>
            </thead>
            <tbody>
              {pphRows.map((row, i) => (
                <tr key={i} className="hover:bg-neutral-50">
                  <td className="p-2 border border-neutral-200 text-center">{i + 1}</td>
                  <td className="p-2 border border-neutral-200 font-mono text-xs">{row.employeeNo}</td>
                  <td className="p-2 border border-neutral-200">{row.employeeName}</td>
                  <td className="p-2 border border-neutral-200 font-mono text-xs">{row.npwp || '—'}</td>
                  <td className="p-2 border border-neutral-200 text-right">{formatIDR(row.grossPay)}</td>
                  <td className="p-2 border border-neutral-200 text-right text-danger-600">{formatIDR(row.pph21)}</td>
                  <td className="p-2 border border-neutral-200 text-right">{formatIDR(row.bpjsKesEmployee)}</td>
                  <td className="p-2 border border-neutral-200 text-right">{formatIDR(row.bpjsKesEmployer)}</td>
                  <td className="p-2 border border-neutral-200 text-right">{formatIDR(row.bpjsJhtEmployee)}</td>
                  <td className="p-2 border border-neutral-200 text-right">{formatIDR(row.bpjsJhtEmployer)}</td>
                  <td className="p-2 border border-neutral-200 text-right">{formatIDR(row.bpjsJpEmployee)}</td>
                  <td className="p-2 border border-neutral-200 text-right">{formatIDR(row.bpjsJpEmployer)}</td>
                  <td className="p-2 border border-neutral-200 text-right">{formatIDR(row.bpjsJkkEmployer)}</td>
                  <td className="p-2 border border-neutral-200 text-right">{formatIDR(row.bpjsJkmEmployer)}</td>
                  <td className="p-2 border border-neutral-200 text-right font-medium">{formatIDR(row.netPay)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="bg-blue-50 font-bold">
                <td colSpan={4} className="p-2 border border-neutral-300">Total ({pphSummary.employeeCount || 0} karyawan)</td>
                <td className="p-2 border border-neutral-300 text-right">{formatIDR(pphSummary.totalGrossPay || 0)}</td>
                <td className="p-2 border border-neutral-300 text-right text-danger-600">{formatIDR(pphSummary.totalPph21 || 0)}</td>
                <td className="p-2 border border-neutral-300 text-right">{formatIDR(pphSummary.totalBpjsEmployee || 0)}</td>
                <td className="p-2 border border-neutral-300 text-right" colSpan={2}></td>
                <td className="p-2 border border-neutral-300 text-right">{formatIDR(pphSummary.totalBpjsEmployer || 0)}</td>
                <td className="p-2 border border-neutral-300 text-right" colSpan={4}></td>
                <td className="p-2 border border-neutral-300 text-right">{formatIDR(pphSummary.totalNetPay || 0)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
    );
  }
  return null;
}
