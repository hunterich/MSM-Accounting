import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../api/apiClient';
type EmployeeIssue = { id: string; name: string; employeeNo: string; ptkpStatus: string | null; ptkpYear: number | null };
type Precheck = { inactiveWithoutEndDate: EmployeeIssue[]; ptkpNeedsConfirmation: EmployeeIssue[] };
export default function PayrollPrecheck() {
    const [year, setYear] = useState(new Date().getFullYear()), [month, setMonth] = useState(new Date().getMonth() + 1);
    const { data, error, isFetching, refetch } = useQuery({ queryKey: ['payrollEmployeePrecheck', year, month], queryFn: () => api.get<Precheck>('/api/v1/payroll-runs/precheck', { year, month }), staleTime: 0 });
    const list = (employees: EmployeeIssue[]) => <ul className="list-disc pl-5">{employees.map(e => <li key={e.id}><a className="underline" href={'/hr/employees/new?mode=edit&employeeId=' + encodeURIComponent(e.id)}>{e.employeeNo} — {e.name}</a>{' (PTKP: ' + (e.ptkpStatus ?? 'missing') + ', year: ' + (e.ptkpYear ?? 'missing') + ')'}</li>)}</ul>;
    return <details className="border rounded p-3 mb-3"><summary>Payroll employee setup pre-check</summary>
        <p className="text-sm my-2">Run before the first payroll after release and before January. Confirm each employee’s actual PTKP for the selected year; no status or year is rolled forward automatically.</p>
        <div className="flex gap-2 my-2"><label>Month<input aria-label="Payroll pre-check month" className="border rounded p-1 w-20 block" type="number" min={1} max={12} value={month} onChange={e => setMonth(Number(e.target.value))}/></label><label>Year<input aria-label="Payroll pre-check year" className="border rounded p-1 w-28 block" type="number" min={2000} max={2100} value={year} onChange={e => setYear(Number(e.target.value))}/></label><button type="button" disabled={isFetching} onClick={() => refetch()}>Refresh pre-check</button></div>
        {error && <p role="alert">{error instanceof Error ? error.message : 'Cannot check employee setup.'}</p>}
        {data && <><p className="font-medium">Inactive employees missing last working day: {data.inactiveWithoutEndDate.length}</p>{list(data.inactiveWithoutEndDate)}<p className="font-medium mt-2">Employees needing PTKP confirmation for {year}: {data.ptkpNeedsConfirmation.length}</p>{list(data.ptkpNeedsConfirmation)}</>}
        <p className="text-sm mt-2">This check lists employee setup only. Dated policies, attendance, deduction accounts and complete posted YTD history still need review. Missing YTD history is a December/final-pay pilot blocker.</p>
    </details>;
}
