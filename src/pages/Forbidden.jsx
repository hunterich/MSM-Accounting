import React from 'react';
import { ShieldAlert, ArrowLeft, LayoutDashboard } from 'lucide-react';
import { useLocation, useNavigate } from 'react-router-dom';
import Button from '../components/UI/Button';
import { useAuthStore } from '../stores/useAuthStore';

const actionLabels = {
  view: 'view',
  create: 'create',
  edit: 'edit',
  delete: 'delete',
};

export default function Forbidden() {
  const navigate = useNavigate();
  const location = useLocation();
  const hasPermission = useAuthStore((s) => s.hasPermission);

  const attemptedPath = location.state?.from?.pathname;
  const action = actionLabels[location.state?.action] || 'access';
  const fallbackPath = (
    [
      { path: '/', moduleKey: 'dashboard' },
      { path: '/gl', moduleKey: 'gl_coa' },
      { path: '/gl/journals', moduleKey: 'gl_journal' },
      { path: '/ar/sales-orders', moduleKey: 'ar_sales_orders' },
      { path: '/ar/invoices', moduleKey: 'ar_invoices' },
      { path: '/ar/payments', moduleKey: 'ar_payments' },
      { path: '/ar/credits', moduleKey: 'ar_credits' },
      { path: '/ar/customers', moduleKey: 'ar_customers' },
      { path: '/ap/pos', moduleKey: 'ap_pos' },
      { path: '/ap/bills', moduleKey: 'ap_bills' },
      { path: '/ap/payments', moduleKey: 'ap_payments' },
      { path: '/ap/debits', moduleKey: 'ap_debits' },
      { path: '/ap/vendors', moduleKey: 'ap_vendors' },
      { path: '/inventory/items', moduleKey: 'inv_items' },
      { path: '/inventory/adjustments', moduleKey: 'inv_adj' },
      { path: '/banking', moduleKey: 'banking' },
      { path: '/hr/employees', moduleKey: 'hr_employees' },
      { path: '/hr/attendance', moduleKey: 'hr_attendance' },
      { path: '/hr/payroll-run', moduleKey: 'hr_payroll' },
      { path: '/integrations', moduleKey: 'integrations' },
      { path: '/reports', moduleKey: 'reports' },
      { path: '/company-setup', moduleKey: 'company' },
      { path: '/settings', moduleKey: 'settings' },
    ].find((entry) => hasPermission(entry.moduleKey, 'view'))?.path
  ) || '/';
  const primaryButtonLabel = fallbackPath === '/' ? 'Go to dashboard' : 'Open allowed page';

  return (
    <div className="mx-auto flex min-h-[calc(100vh-8rem)] w-full max-w-3xl items-center justify-center">
      <section className="w-full overflow-hidden rounded-3xl border border-danger-200 bg-white shadow-lg">
        <div className="bg-gradient-to-r from-danger-50 via-white to-warning-50 px-8 py-10">
          <div className="mb-5 inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-danger-100 text-danger-600">
            <ShieldAlert size={28} />
          </div>
          <p className="mb-2 text-sm font-semibold uppercase tracking-[0.16em] text-danger-600">
            Access denied
          </p>
          <h1 className="text-3xl font-semibold text-neutral-900">403 Forbidden</h1>
          <p className="mt-3 max-w-2xl text-base text-neutral-700">
            Your current role does not have permission to {action} this page.
          </p>
          {attemptedPath ? (
            <p className="mt-4 rounded-2xl border border-neutral-200 bg-neutral-50 px-4 py-3 text-sm text-neutral-600">
              Requested URL: <span className="font-medium text-neutral-900">{attemptedPath}</span>
            </p>
          ) : null}
        </div>

        <div className="flex flex-wrap gap-3 px-8 py-6">
          <Button
            text={primaryButtonLabel}
            icon={<LayoutDashboard size={16} />}
            onClick={() => navigate(fallbackPath)}
          />
          <Button
            text="Go back"
            variant="secondary"
            icon={<ArrowLeft size={16} />}
            onClick={() => navigate(-1)}
          />
        </div>
      </section>
    </div>
  );
}
