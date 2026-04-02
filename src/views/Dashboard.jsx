import React, { useMemo, useState } from 'react';
import { Settings, Plus, X } from 'lucide-react';
import ListPage from '../components/Layout/ListPage';
import { ErrorBoundary, WidgetErrorFallback } from '../components/UI/ErrorBoundary';
import Button from '../components/UI/Button';
import Modal from '../components/UI/Modal';
import { WIDGET_REGISTRY, DEFAULT_WIDGET_IDS } from '../config/dashboardWidgets';
import { useSettingsStore } from '../stores/useSettingsStore';
import { useAccessStore } from '../stores/useAccessStore';

// Widget components
import CashOnHandWidget       from '../components/dashboard/widgets/CashOnHandWidget';
import OverdueInvoicesWidget  from '../components/dashboard/widgets/OverdueInvoicesWidget';
import NetCashFlowWidget      from '../components/dashboard/widgets/NetCashFlowWidget';
import OutstandingBillsWidget from '../components/dashboard/widgets/OutstandingBillsWidget';
import RecentInvoicesWidget   from '../components/dashboard/widgets/RecentInvoicesWidget';
import RecentPaymentsWidget   from '../components/dashboard/widgets/RecentPaymentsWidget';
import RecentBillsWidget      from '../components/dashboard/widgets/RecentBillsWidget';

const WIDGET_COMPONENTS = {
    cash_on_hand:      CashOnHandWidget,
    overdue_invoices:  OverdueInvoicesWidget,
    net_cash_flow:     NetCashFlowWidget,
    outstanding_bills: OutstandingBillsWidget,
    recent_invoices:   RecentInvoicesWidget,
    recent_payments:   RecentPaymentsWidget,
    recent_bills:      RecentBillsWidget,
};

const Dashboard = () => {
    const [isEditMode, setIsEditMode] = useState(false);
    const [isAddOpen, setIsAddOpen]   = useState(false);

    const currentUser         = useAccessStore((s) => s.getCurrentUser());
    const hasPermission       = useAccessStore((s) => s.hasPermission);
    const dashboardConfig     = useSettingsStore((s) => s.dashboardConfig);
    const setDashboardWidgets = useSettingsStore((s) => s.setDashboardWidgets);

    // Active widget IDs — user's saved list, filtered by current RBAC
    const activeWidgetIds = useMemo(() => {
        const saved = dashboardConfig[currentUser?.id] ?? DEFAULT_WIDGET_IDS;
        return saved.filter((id) => {
            const meta = WIDGET_REGISTRY.find((w) => w.id === id);
            return meta && hasPermission(meta.permission, 'view');
        });
    }, [currentUser, dashboardConfig, hasPermission]);

    // Widgets the user is permitted to add but hasn't added yet
    const addableWidgets = useMemo(() =>
        WIDGET_REGISTRY.filter(
            (w) => hasPermission(w.permission, 'view') && !activeWidgetIds.includes(w.id)
        ),
        [activeWidgetIds, hasPermission]
    );

    const removeWidget = (id) => {
        setDashboardWidgets(currentUser.id, activeWidgetIds.filter((w) => w !== id));
    };

    const addWidget = (id) => {
        setDashboardWidgets(currentUser.id, [...activeWidgetIds, id]);
        if (addableWidgets.length === 1) setIsAddOpen(false);
    };

    const handleDoneCustomizing = () => {
        setIsEditMode(false);
        setIsAddOpen(false);
    };

    return (
        <ListPage
            containerClassName=""
            title="Dashboard"
            subtitle="Overview of key financial metrics and recent activity."
            actions={
                <Button
                    text={isEditMode ? 'Done Customizing' : 'Customize Dashboard'}
                    variant="secondary"
                    icon={<Settings size={16} />}
                    onClick={isEditMode ? handleDoneCustomizing : () => setIsEditMode(true)}
                />
            }
        >
            <div className="grid grid-cols-12 gap-4">
                {activeWidgetIds.map((id) => {
                    const meta = WIDGET_REGISTRY.find((w) => w.id === id);
                    const WidgetComponent = WIDGET_COMPONENTS[id];
                    if (!meta || !WidgetComponent) return null;
                    const colSpan = meta.size === 'lg' ? 'col-span-12' : 'col-span-4';
                    return (
                        <div key={id} className={`${colSpan} relative ${isEditMode ? 'animate-shake' : ''}`}>
                            {isEditMode && (
                                <button
                                    onClick={() => removeWidget(id)}
                                    className="absolute -top-2 -right-2 z-10 bg-danger-500 text-white rounded-full w-6 h-6 flex items-center justify-center shadow-md hover:bg-danger-600 transition-colors"
                                    title={`Remove ${meta.label}`}
                                >
                                    <X size={12} />
                                </button>
                            )}
                            <ErrorBoundary fallback={WidgetErrorFallback}>
                                <WidgetComponent />
                            </ErrorBoundary>
                        </div>
                    );
                })}

                {/* Add Widget placeholder — only in edit mode */}
                {isEditMode && addableWidgets.length > 0 && (
                    <div className="col-span-4">
                        <button
                            onClick={() => setIsAddOpen(true)}
                            className="w-full h-full min-h-[140px] border-2 border-dashed border-neutral-300 rounded-lg flex flex-col items-center justify-center gap-2 text-neutral-500 hover:border-primary-400 hover:text-primary-600 transition-colors bg-transparent cursor-pointer"
                        >
                            <Plus size={24} />
                            <span className="text-sm font-medium">Add Widget</span>
                        </button>
                    </div>
                )}

                {/* Empty state when all widgets removed */}
                {activeWidgetIds.length === 0 && !isEditMode && (
                    <div className="col-span-12 text-center py-16 text-neutral-500">
                        <p className="mb-3">No widgets on your dashboard.</p>
                        <Button
                            text="Customize Dashboard"
                            variant="secondary"
                            icon={<Settings size={16} />}
                            onClick={() => setIsEditMode(true)}
                        />
                    </div>
                )}
            </div>

            {/* Add Widget Modal */}
            <Modal isOpen={isAddOpen} onClose={() => setIsAddOpen(false)} title="Add Widget" size="sm">
                <div className="flex flex-col gap-3">
                    {addableWidgets.map((w) => (
                        <button
                            key={w.id}
                            onClick={() => addWidget(w.id)}
                            className="text-left p-4 rounded-lg border border-neutral-200 hover:border-primary-400 hover:bg-primary-50 transition-colors cursor-pointer bg-transparent w-full"
                        >
                            <div className="font-semibold text-neutral-900 text-sm">{w.label}</div>
                            <div className="text-xs text-neutral-500 mt-0.5">{w.description}</div>
                        </button>
                    ))}
                    {addableWidgets.length === 0 && (
                        <p className="text-neutral-500 text-sm text-center py-4">
                            All available widgets are already on your dashboard.
                        </p>
                    )}
                </div>
            </Modal>
        </ListPage>
    );
};

export default Dashboard;
