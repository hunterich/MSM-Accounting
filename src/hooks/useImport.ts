import { useMutation } from '@tanstack/react-query';
import { api } from '../api/apiClient';

export type ImportEntity = 'customers' | 'vendors' | 'items' | 'accounts';

export interface ImportRow {
  [key: string]: string | number | boolean | undefined;
}

export interface ImportResult {
  dryRun?: boolean;
  valid?: number;
  invalid?: number;
  created?: number;
  skipped?: number;
  errors: { row: number; message: string }[];
}

export function useImport(entity: ImportEntity) {
  return useMutation<ImportResult, Error, { rows: ImportRow[]; dryRun?: boolean }>({
    mutationFn: ({ rows, dryRun }) =>
      api.post(`/api/v1/import/${entity}`, { rows, dryRun }),
  });
}
