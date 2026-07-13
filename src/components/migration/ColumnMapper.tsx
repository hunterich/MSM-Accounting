import React from 'react';
import SearchableSelect from '../UI/SearchableSelect';
import { ENTITY_FIELDS, MigrationEntity } from '../../utils/migrationFields';

export interface ColumnMapperProps {
  headers: string[];
  entity: MigrationEntity;
  mapping: Record<string, string | null>;
  onChange: (field: string, header: string | null) => void;
}

/** Sentinel used as SearchableSelect's `value` for "not mapped" — SearchableSelect
 * only accepts a string, so `null` (no column chosen) is represented as ''
 * at the UI boundary and converted back to `null` before calling onChange. */
const NONE_VALUE = '';

/**
 * Presentational field-to-column mapping grid for the migration wizard.
 * Renders one row per target field (from ENTITY_FIELDS[entity]) with a
 * SearchableSelect for picking which uploaded column feeds it. No fetching
 * or parsing here — the parent owns `mapping` state and passes it back in.
 */
const ColumnMapper: React.FC<ColumnMapperProps> = ({ headers, entity, mapping, onChange }) => {
  const fields = ENTITY_FIELDS[entity];

  const options = [
    { value: NONE_VALUE, label: '— none —' },
    ...headers.map((h) => ({ value: h, label: h })),
  ];

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1">
      {fields.map((spec) => {
        const selected = mapping[spec.field] ?? null;
        const showRequiredHint = spec.required && !selected;

        return (
          <div key={spec.field} className="flex flex-col">
            <label className="text-sm font-medium text-neutral-700 mb-1">
              {spec.label}
              {spec.required && <span className="text-red-500"> *</span>}
            </label>
            <SearchableSelect
              options={options}
              value={selected ?? NONE_VALUE}
              onChange={(val) => onChange(spec.field, val === NONE_VALUE ? null : val)}
              placeholder="Select column..."
            />
            {showRequiredHint && (
              <p className="text-xs text-red-500 -mt-2 mb-2">required — pick a column</p>
            )}
          </div>
        );
      })}
    </div>
  );
};

export default ColumnMapper;
