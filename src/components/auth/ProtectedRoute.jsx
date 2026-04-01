import React, { useEffect } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuthStore } from '../../stores/useAuthStore';
import { hasModulePermission } from '../../stores/useAuthStore';

export default function ProtectedRoute({ children }) {
  const location = useLocation();
  const user = useAuthStore((s) => s.user);
  const isLoading = useAuthStore((s) => s.isLoading);
  const permissions = useAuthStore((s) => s.permissions);
  const needsInventoryValuationSetup = useAuthStore((s) => s.needsInventoryValuationSetup);
  const checkSession = useAuthStore((s) => s.checkSession);

  useEffect(() => {
    checkSession();
  }, [checkSession]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-screen bg-neutral-50 text-neutral-700">
        Loading...
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }

  if (needsInventoryValuationSetup) {
    const canManageCompanySetup = hasModulePermission(permissions, 'company', 'view');
    if (location.pathname !== '/company-setup' && canManageCompanySetup) {
      return <Navigate to="/company-setup?onboarding=inventory-valuation" replace state={{ from: location }} />;
    }

    if (!canManageCompanySetup) {
      return (
        <div className="flex min-h-screen items-center justify-center bg-neutral-50 px-6 text-neutral-700">
          <div className="w-full max-w-xl rounded-2xl border border-amber-200 bg-amber-50 p-6 shadow-sm">
            <h1 className="text-xl font-semibold text-amber-900">Inventory valuation setup is still required</h1>
            <p className="mt-3 text-sm leading-6 text-amber-900/90">
              An administrator needs to choose your company&apos;s costing method before the workspace can be used.
            </p>
          </div>
        </div>
      );
    }
  }

  return children;
}
