import React from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuthStore } from '../../stores/useAuthStore';

export default function PermissionRoute({ children, moduleKey, action = 'view' }) {
  const location = useLocation();
  const user = useAuthStore((s) => s.user);
  const isLoading = useAuthStore((s) => s.isLoading);
  const hasPermission = useAuthStore((s) => s.hasPermission);

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

  if (!moduleKey || hasPermission(moduleKey, action)) {
    return children;
  }

  return (
    <Navigate
      to="/403"
      replace
      state={{
        from: location,
        moduleKey,
        action,
      }}
    />
  );
}
