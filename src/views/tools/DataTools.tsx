import React from 'react';
import { useSearchParams } from 'react-router-dom';
import Card from '../../components/UI/Card';
import AuditLogPanel from '../../components/UI/AuditLogPanel';
import DataMigrationPanel from '../settings/DataMigrationPanel';
import CsvImportPanel from '../settings/CsvImportPanel';
import BackupPanel from '../settings/BackupPanel';
import { ScrollText, DatabaseZap, Upload, DatabaseBackup, ArrowRightLeft } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { MIGRATION_WIZARD_ENABLED } from '../../config/featureFlags';

interface ToolItem {
    id: string;
    label: string;
    icon: LucideIcon;
}

// Operational data tools — actions rather than configuration. These used to
// live as tabs inside Settings; they were relocated here so Settings stays
// "set & forget" preferences only.
const TOOL_ITEMS: ToolItem[] = [
    { id: 'audit', label: 'Audit Log', icon: ScrollText },
    { id: 'migration', label: 'Data Migration', icon: DatabaseZap },
    { id: 'csv-import', label: 'CSV Import', icon: Upload },
    { id: 'backup', label: 'Backup & Restore', icon: DatabaseBackup },
    ...(MIGRATION_WIZARD_ENABLED
        ? [{ id: 'migration-wizard', label: 'Migration Wizard', icon: ArrowRightLeft }]
        : []),
];

const VALID_TAB_IDS = new Set(TOOL_ITEMS.map((i) => i.id));

const DataTools = (): React.ReactElement => {
    const [searchParams, setSearchParams] = useSearchParams();
    const rawTab = searchParams.get('tab') || 'audit';
    const activeTab = VALID_TAB_IDS.has(rawTab) ? rawTab : 'audit';
    const setActiveTab = (id: string) => setSearchParams(id === 'audit' ? {} : { tab: id });

    return (
        <div className="container settings-module settings-layout">

            {/* Sidebar Navigation */}
            <div>
                <h2 className="settings-title">Data &amp; Tools</h2>
                <div className="settings-nav-list">
                    {TOOL_ITEMS.map((item) => {
                        const Icon = item.icon;
                        return (
                            <button
                                key={item.id}
                                onClick={() => setActiveTab(item.id)}
                                className={`settings-nav-item ${activeTab === item.id ? 'active' : ''}`}
                            >
                                <Icon size={18} /> {item.label}
                            </button>
                        );
                    })}
                </div>
            </div>

            {/* Content Area */}
            <div>
                <div className="settings-content-title-wrap">
                    <h1 className="settings-content-title">
                        {TOOL_ITEMS.find((i) => i.id === activeTab)?.label || 'Data & Tools'}
                    </h1>
                </div>

                {activeTab === 'audit' && (
                    <Card title="Audit Log">
                        <p className="settings-muted">Riwayat seluruh perubahan data — siapa mengubah apa dan kapan.</p>
                        <AuditLogPanel />
                    </Card>
                )}

                {activeTab === 'migration' && (
                    <Card title="Migrasi Data">
                        <p className="settings-muted">Pindahkan data dari localStorage (versi lama) ke database PostgreSQL.</p>
                        <DataMigrationPanel />
                    </Card>
                )}

                {activeTab === 'csv-import' && (
                    <Card title="CSV Import">
                        <p className="settings-muted mb-4">Bulk-import customers, vendors, items, or chart of accounts from a CSV file. Download the template, fill in your data, then upload.</p>
                        <CsvImportPanel />
                    </Card>
                )}

                {activeTab === 'backup' && (
                    <BackupPanel />
                )}

                {activeTab === 'migration-wizard' && (
                    <div className="p-6 text-sm text-gray-500">Migration wizard coming soon</div>
                )}
            </div>
        </div>
    );
};

export default DataTools;
