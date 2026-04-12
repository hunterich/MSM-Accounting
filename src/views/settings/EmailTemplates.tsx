import React, { useState, useMemo } from 'react';
import { Eye, Plus, Edit2, Trash2, X, Code } from 'lucide-react';
import Card from '../../components/UI/Card';
import Button from '../../components/UI/Button';
import Table, { TableColumn } from '../../components/UI/Table';
import Modal from '../../components/UI/Modal';
import Input from '../../components/UI/Input';
import StatusTag from '../../components/UI/StatusTag';
import {
  useEmailTemplates,
  useCreateEmailTemplate,
  useUpdateEmailTemplate,
  useDeleteEmailTemplate,
  type EmailTemplate,
} from '../../hooks/useEmail';

const TEMPLATE_TYPES = [
  { value: 'INVOICE', label: 'Invoice' },
  { value: 'PAYMENT_REMINDER', label: 'Payment Reminder' },
  { value: 'PURCHASE_ORDER', label: 'Purchase Order' },
];

const SAMPLE_VARIABLES: Record<string, Record<string, string>> = {
  INVOICE: {
    invoiceNumber: 'INV-2026-0042',
    companyName: 'MSM Trading Indonesia',
    customerName: 'PT Maju Jaya',
    amount: 'Rp 15.000.000',
    dueDate: '2026-05-15',
    companyEmail: 'finance@msm.co.id',
    companyPhone: '021-1234567',
  },
  PAYMENT_REMINDER: {
    invoiceNumber: 'INV-2026-0042',
    companyName: 'MSM Trading Indonesia',
    customerName: 'PT Maju Jaya',
    amount: 'Rp 15.000.000',
    daysOverdue: '14',
    dueDate: '2026-04-01',
  },
  PURCHASE_ORDER: {
    poNumber: 'PO-2026-0018',
    companyName: 'MSM Trading Indonesia',
    vendorName: 'PT Supplier Utama',
    amount: 'Rp 8.500.000',
    expectedDate: '2026-05-01',
  },
};

function renderPreview(template: string, variables: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => variables[key] ?? `{{${key}}}`);
}

interface FormState {
  name: string;
  type: string;
  subject: string;
  bodyHtml: string;
  bodyText: string;
  variables: string[];
  isDefault: boolean;
  isActive: boolean;
}

const EMPTY_FORM: FormState = {
  name: '',
  type: 'INVOICE',
  subject: '',
  bodyHtml: '',
  bodyText: '',
  variables: [],
  isDefault: false,
  isActive: true,
};

const EmailTemplates: React.FC = () => {
  const [filterType, setFilterType] = useState<string>('');
  const { data: templateData, isLoading } = useEmailTemplates(filterType || undefined);
  const createTemplate = useCreateEmailTemplate();
  const updateTemplate = useUpdateEmailTemplate();
  const deleteTemplate = useDeleteEmailTemplate();

  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewHtml, setPreviewHtml] = useState('');
  const [previewSubject, setPreviewSubject] = useState('');

  const templates = useMemo(() => {
    const list = templateData?.data ?? [];
    return list.map((t: EmailTemplate) => ({
      ...t,
      variables: typeof t.variables === 'string' ? JSON.parse(t.variables) : (t.variables || []),
    }));
  }, [templateData]);

  const openCreate = () => {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setModalOpen(true);
  };

  const openEdit = (template: EmailTemplate & { variables: string[] }) => {
    setEditingId(template.id);
    setForm({
      name: template.name,
      type: template.type,
      subject: template.subject,
      bodyHtml: template.bodyHtml,
      bodyText: template.bodyText,
      variables: template.variables,
      isDefault: template.isDefault,
      isActive: template.isActive,
    });
    setModalOpen(true);
  };

  const openPreview = (template: EmailTemplate & { variables: string[] }) => {
    const sampleVars = SAMPLE_VARIABLES[template.type] || {};
    setPreviewSubject(renderPreview(template.subject, sampleVars));
    setPreviewHtml(renderPreview(template.bodyHtml, sampleVars));
    setPreviewOpen(true);
  };

  const handleSave = async () => {
    if (!form.name || !form.type || !form.subject) {
      window.alert('Name, type, and subject are required.');
      return;
    }
    if (editingId) {
      await updateTemplate.mutateAsync({ id: editingId, ...form });
    } else {
      await createTemplate.mutateAsync(form);
    }
    setModalOpen(false);
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm('Are you sure you want to delete this template?')) return;
    await deleteTemplate.mutateAsync(id);
  };

  const handleSeedDefaults = async () => {
    await createTemplate.mutateAsync({ seedDefaults: true } as any);
  };

  const availableVars = SAMPLE_VARIABLES[form.type] || {};

  const columns: TableColumn<EmailTemplate & { variables: string[] }>[] = [
    { key: 'name', label: 'Name' },
    {
      key: 'type',
      label: 'Type',
      render: (val) => {
        const t = TEMPLATE_TYPES.find((tt) => tt.value === val);
        return <StatusTag status={t?.label ?? (val as string)} />;
      },
    },
    { key: 'subject', label: 'Subject' },
    {
      key: 'isDefault',
      label: 'Default',
      render: (val) =>
        val ? (
          <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-primary-100 text-primary-800">
            Default
          </span>
        ) : null,
    },
    {
      key: 'isActive',
      label: 'Active',
      render: (val) => <StatusTag status={val ? 'Active' : 'Inactive'} />,
    },
    {
      key: 'id',
      label: 'Actions',
      render: (_val, row) => (
        <div className="flex items-center gap-1">
          <button
            onClick={() => openPreview(row as EmailTemplate & { variables: string[] })}
            className="p-1.5 text-neutral-500 hover:text-primary-600 rounded"
            title="Preview"
          >
            <Eye size={16} />
          </button>
          <button
            onClick={() => openEdit(row as EmailTemplate & { variables: string[] })}
            className="p-1.5 text-neutral-500 hover:text-primary-600 rounded"
            title="Edit"
          >
            <Edit2 size={16} />
          </button>
          <button
            onClick={() => handleDelete((row as any).id)}
            className="p-1.5 text-neutral-500 hover:text-danger-600 rounded"
            title="Delete"
          >
            <Trash2 size={16} />
          </button>
        </div>
      ),
    },
  ];

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <select
            className="h-9 px-3 text-sm border border-neutral-300 rounded-md bg-neutral-0 focus:border-primary-500 focus:outline-0"
            value={filterType}
            onChange={(e) => setFilterType(e.target.value)}
          >
            <option value="">All Types</option>
            {TEMPLATE_TYPES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
        </div>
        <div className="flex items-center gap-2">
          {templates.length === 0 && (
            <Button
              text="Seed Defaults"
              variant="secondary"
              size="small"
              icon={<Code size={14} />}
              onClick={handleSeedDefaults}
              disabled={createTemplate.isPending}
            />
          )}
          <Button text="New Template" variant="primary" size="small" icon={<Plus size={14} />} onClick={openCreate} />
        </div>
      </div>

      <Card padding={false}>
        {isLoading ? (
          <div className="p-8 text-center text-neutral-500">Loading templates...</div>
        ) : templates.length === 0 ? (
          <div className="p-8 text-center text-neutral-500">
            No email templates found. Click "Seed Defaults" to create starter templates.
          </div>
        ) : (
          <Table columns={columns} data={templates} />
        )}
      </Card>

      {/* Create/Edit Modal */}
      {modalOpen && (
        <Modal title={editingId ? 'Edit Template' : 'New Template'} onClose={() => setModalOpen(false)} size="lg">
          <div className="space-y-4 p-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="form-label">Name</label>
                <Input value={form.name} onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))} />
              </div>
              <div>
                <label className="form-label">Type</label>
                <select
                  className="block w-full h-10 px-3 text-sm border border-neutral-300 rounded-md bg-neutral-0 focus:border-primary-500 focus:outline-0"
                  value={form.type}
                  onChange={(e) => setForm((p) => ({ ...p, type: e.target.value }))}
                >
                  {TEMPLATE_TYPES.map((t) => (
                    <option key={t.value} value={t.value}>
                      {t.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div>
              <label className="form-label">Subject</label>
              <Input
                value={form.subject}
                onChange={(e) => setForm((p) => ({ ...p, subject: e.target.value }))}
                placeholder="e.g. Invoice {{invoiceNumber}} from {{companyName}}"
              />
            </div>

            <div>
              <label className="form-label">Body (HTML)</label>
              <textarea
                className="block w-full px-3 py-2 text-sm border border-neutral-300 rounded-md bg-neutral-0 font-mono focus:border-primary-500 focus:outline-0 min-h-[200px]"
                value={form.bodyHtml}
                onChange={(e) => setForm((p) => ({ ...p, bodyHtml: e.target.value }))}
                rows={10}
              />
            </div>

            <div>
              <label className="form-label">Body (Plain Text)</label>
              <textarea
                className="block w-full px-3 py-2 text-sm border border-neutral-300 rounded-md bg-neutral-0 focus:border-primary-500 focus:outline-0"
                value={form.bodyText}
                onChange={(e) => setForm((p) => ({ ...p, bodyText: e.target.value }))}
                rows={4}
              />
            </div>

            {/* Variable reference panel */}
            <div className="bg-neutral-50 border border-neutral-200 rounded-lg p-3">
              <div className="text-xs font-semibold text-neutral-600 mb-2">Available Variables</div>
              <div className="flex flex-wrap gap-1.5">
                {Object.keys(availableVars).map((v) => (
                  <button
                    key={v}
                    type="button"
                    className="inline-flex items-center px-2 py-0.5 rounded text-xs font-mono bg-primary-100 text-primary-700 hover:bg-primary-200 transition"
                    onClick={() => {
                      navigator.clipboard.writeText(`{{${v}}}`);
                    }}
                    title={`Click to copy {{${v}}}`}
                  >
                    {`{{${v}}}`}
                  </button>
                ))}
              </div>
              <div className="text-xs text-neutral-500 mt-1">Click to copy variable to clipboard</div>
            </div>

            <div className="flex items-center gap-4">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={form.isDefault}
                  onChange={(e) => setForm((p) => ({ ...p, isDefault: e.target.checked }))}
                  className="w-4 h-4 text-primary-600 rounded"
                />
                Default template
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={form.isActive}
                  onChange={(e) => setForm((p) => ({ ...p, isActive: e.target.checked }))}
                  className="w-4 h-4 text-primary-600 rounded"
                />
                Active
              </label>
            </div>

            <div className="flex justify-between pt-2">
              <Button
                text="Preview"
                variant="secondary"
                icon={<Eye size={14} />}
                onClick={() => {
                  const vars = SAMPLE_VARIABLES[form.type] || {};
                  setPreviewSubject(renderPreview(form.subject, vars));
                  setPreviewHtml(renderPreview(form.bodyHtml, vars));
                  setPreviewOpen(true);
                }}
              />
              <div className="flex gap-2">
                <Button text="Cancel" variant="secondary" onClick={() => setModalOpen(false)} />
                <Button
                  text={editingId ? 'Save Changes' : 'Create'}
                  variant="primary"
                  onClick={handleSave}
                  disabled={createTemplate.isPending || updateTemplate.isPending}
                />
              </div>
            </div>
          </div>
        </Modal>
      )}

      {/* Preview Modal */}
      {previewOpen && (
        <Modal title="Template Preview" onClose={() => setPreviewOpen(false)} size="lg">
          <div className="p-4">
            <div className="mb-4">
              <div className="text-xs font-semibold text-neutral-500 mb-1">Subject</div>
              <div className="text-sm font-medium text-neutral-800 bg-neutral-50 rounded px-3 py-2 border border-neutral-200">
                {previewSubject}
              </div>
            </div>
            <div className="text-xs font-semibold text-neutral-500 mb-1">Body</div>
            <div
              className="border border-neutral-200 rounded-lg bg-white p-4 overflow-auto max-h-[500px]"
              dangerouslySetInnerHTML={{ __html: previewHtml }}
            />
            <div className="flex justify-end mt-4">
              <Button text="Close" variant="secondary" onClick={() => setPreviewOpen(false)} />
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
};

export default EmailTemplates;
