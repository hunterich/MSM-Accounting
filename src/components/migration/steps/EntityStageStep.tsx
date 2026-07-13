import React, { useMemo, useState } from 'react';
import FileDropzone from '../FileDropzone';
import ColumnMapper from '../ColumnMapper';
import Button from '../../UI/Button';
import Card from '../../UI/Card';
import Table, { type TableColumn } from '../../UI/Table';
import {
  ENTITY_FIELDS,
  requiredFields,
  type MigrationEntity,
} from '../../../utils/migrationFields';
import {
  parseSpreadsheet,
  autoMapColumns,
  applyMapping,
} from '../../../utils/migrationImport';
import { useStageEntity, type StageResult, type MigrationRow } from '../../../hooks/useMigration';
import { useToastStore } from '../../../stores/useToastStore';

export interface EntityStageStepProps {
  batchId: string;
  entity: MigrationEntity;
  title: string;
  /** If true, show a "Skip this step" button that calls `onSkip`. */
  optional?: boolean;
  onStaged: (result: StageResult) => void;
  onSkip?: () => void;
  onBack?: () => void;
}

type Sub = 'upload' | 'map' | 'preview';

const PREVIEW_ROW_LIMIT = 20;

/** Build a CSV string from a header row and data rows (quoted cells). */
function toCsv(columns: string[], rows: string[][]): string {
  const esc = (c: string): string => `"${String(c).replace(/"/g, '""')}"`;
  return [columns.map(esc).join(','), ...rows.map((r) => r.map(esc).join(','))].join('\n');
}

/** Replicates CsvImportPanel's Blob+anchor download pattern. */
function downloadCsv(filename: string, content: string): void {
  const blob = new Blob([content], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * Reusable wizard step that walks ONE migration entity through
 * upload → column-map → preview → stage. Composed by the migration wizard for
 * every entity (master data and opening balances alike); all entity-specific
 * behaviour lives in `ENTITY_FIELDS` / `applyMapping`, so there is no branching
 * on `entity` here beyond reading its field spec.
 */
const EntityStageStep: React.FC<EntityStageStepProps> = ({
  batchId,
  entity,
  title,
  optional = false,
  onStaged,
  onSkip,
  onBack,
}) => {
  const [sub, setSub] = useState<Sub>('upload');
  const [fileName, setFileName] = useState<string | undefined>(undefined);
  const [headers, setHeaders] = useState<string[]>([]);
  const [rows, setRows] = useState<(string | number)[][]>([]);
  const [mapping, setMapping] = useState<Record<string, string | null>>({});
  const [result, setResult] = useState<StageResult | null>(null);

  const pushToast = useToastStore((s) => s.pushToast);
  const stageMutation = useStageEntity(batchId);

  const fields = ENTITY_FIELDS[entity];
  const reqFields = useMemo(() => requiredFields(entity), [entity]);

  const objectRows = useMemo(
    () => applyMapping(rows, headers, mapping, entity),
    [rows, headers, mapping, entity],
  );

  const allRequiredMapped = reqFields.every((f) => mapping[f] != null);

  // Rows missing a value for any required field (client-side hint only —
  // the server validates authoritatively at stage time).
  const problemRowCount = useMemo(() => {
    return objectRows.filter((r) =>
      reqFields.some((f) => {
        const v = r[f];
        return v == null || String(v).trim() === '';
      }),
    ).length;
  }, [objectRows, reqFields]);

  // ── upload ────────────────────────────────────────────────────────────────
  const handleFile = async (file: File): Promise<void> => {
    try {
      const parsed = await parseSpreadsheet(file);
      setFileName(file.name);
      setHeaders(parsed.headers);
      setRows(parsed.rows);
      setMapping(autoMapColumns(parsed.headers, entity));
      setSub('map');
    } catch (err) {
      pushToast(
        `Could not read file: ${err instanceof Error ? err.message : String(err)}`,
        'error',
      );
    }
  };

  const handleDownloadTemplate = (): void => {
    const columns = fields.map((f) => f.field);
    // One sample/blank row so the header row's shape is obvious.
    const sample = columns.map(() => '');
    downloadCsv(`migration-template-${entity}.csv`, toCsv(columns, [sample]));
  };

  // ── preview → stage ─────────────────────────────────────────────────────────
  const handleStage = async (): Promise<void> => {
    try {
      const res = await stageMutation.mutateAsync({
        entity,
        rows: objectRows as MigrationRow[],
      });
      setResult(res);
      pushToast(`Staged ${res.staged} ${entity}`, 'success');
      onStaged(res);
    } catch (err) {
      pushToast(err instanceof Error ? err.message : String(err), 'error');
    }
  };

  const previewColumns: TableColumn[] = fields
    .filter((f) => mapping[f.field] != null)
    .map((f) => ({ key: f.field, label: f.label }));

  const requiredHint = reqFields.length > 0 ? reqFields.join(', ') : '(none)';

  return (
    <Card title={title}>
      {sub === 'upload' && (
        <div className="flex flex-col gap-4">
          <p className="text-sm text-neutral-600">
            Upload your Accurate export for this step. Required columns:{' '}
            <span className="font-medium text-neutral-800">{requiredHint}</span>.
          </p>

          <FileDropzone onFile={handleFile} selectedName={fileName} />

          <div className="flex items-center gap-2">
            <Button variant="secondary" onClick={handleDownloadTemplate}>
              Download template
            </Button>
            {onBack && (
              <Button variant="ghost" onClick={onBack}>
                Back
              </Button>
            )}
            {optional && (
              <Button variant="ghost" onClick={() => onSkip?.()} className="ml-auto">
                Skip this step
              </Button>
            )}
          </div>
        </div>
      )}

      {sub === 'map' && (
        <div className="flex flex-col gap-4">
          <p className="text-sm text-neutral-600">
            Match each target field to a column from{' '}
            <span className="font-medium text-neutral-800">{fileName}</span>. Required fields
            are marked with <span className="text-red-500">*</span>.
          </p>

          <ColumnMapper
            headers={headers}
            entity={entity}
            mapping={mapping}
            onChange={(field, header) =>
              setMapping((m) => ({ ...m, [field]: header }))
            }
          />

          <div className="flex items-center gap-2">
            <Button variant="ghost" onClick={() => setSub('upload')}>
              Back to upload
            </Button>
            <Button
              onClick={() => setSub('preview')}
              disabled={!allRequiredMapped}
              className="ml-auto"
            >
              Next: preview
            </Button>
          </div>
        </div>
      )}

      {sub === 'preview' && (
        <div className="flex flex-col gap-4">
          <div className="flex items-baseline justify-between">
            <p className="text-sm font-medium text-neutral-800">
              {objectRows.length} row{objectRows.length === 1 ? '' : 's'} ready
            </p>
            {problemRowCount > 0 && (
              <p className="text-xs text-amber-600">
                {problemRowCount} row{problemRowCount === 1 ? '' : 's'} missing a required
                value — the server will validate on stage
              </p>
            )}
          </div>

          <Table
            columns={previewColumns}
            data={objectRows.slice(0, PREVIEW_ROW_LIMIT) as Record<string, unknown>[]}
          />
          {objectRows.length > PREVIEW_ROW_LIMIT && (
            <p className="text-xs text-neutral-400">
              Showing first {PREVIEW_ROW_LIMIT} of {objectRows.length} rows.
            </p>
          )}

          {result?.errors && result.errors.length > 0 && (
            <div className="rounded-md border border-amber-200 bg-amber-50 p-3">
              <p className="text-sm font-medium text-amber-800 mb-1">
                {result.errors.length} row{result.errors.length === 1 ? '' : 's'} reported
                errors:
              </p>
              <ul className="text-xs text-amber-700 list-disc pl-5 space-y-0.5 max-h-40 overflow-y-auto">
                {result.errors.map((e, i) => (
                  <li key={i}>
                    Row {e.row}: {e.message}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="flex items-center gap-2">
            <Button variant="ghost" onClick={() => setSub('map')}>
              Back to mapping
            </Button>
            <Button
              onClick={handleStage}
              loading={stageMutation.isPending}
              disabled={stageMutation.isPending || objectRows.length === 0}
              className="ml-auto"
            >
              Stage {objectRows.length} row{objectRows.length === 1 ? '' : 's'}
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
};

export default EntityStageStep;
