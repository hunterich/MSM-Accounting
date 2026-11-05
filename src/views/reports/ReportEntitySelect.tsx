import { useQuery } from '@tanstack/react-query';
import { ChevronDown } from 'lucide-react';
import React, { useEffect, useId, useRef, useState } from 'react';
import { api } from '../../api/apiClient';
import { useDebouncedSearch } from '../../hooks/useDebouncedSearch';
import { getActiveOrgId } from '../../lib/activeOrg';
import {
  fetchReportEntities, REPORT_PICKER_PAGE_SIZE,
  type ReportEntity, type ReportEntityKind,
} from './reportEntityQuery';

interface ReportEntitySelectProps {
  kind: ReportEntityKind;
  label: string;
  value: string;
  /** Name-based report filters store the name rather than the master record id. */
  selectedName?: string;
  onChange: (id: string, name: string) => void;
  placeholder: string;
  className?: string;
}

/** A bounded, searchable picker. Opening a report never downloads the catalog. */
export default function ReportEntitySelect({
  kind, label, value, selectedName, onChange, placeholder, className = '',
}: ReportEntitySelectProps): React.ReactElement {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [chosen, setChosen] = useState<ReportEntity | null>(null);
  const debouncedSearch = useDebouncedSearch(search);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const id = useId();
  const orgId = getActiveOrgId();
  const results = useQuery({
    queryKey: ['reportEntities', orgId, kind, debouncedSearch, page],
    queryFn: () => fetchReportEntities(kind, debouncedSearch, page),
    enabled: open && search === debouncedSearch,
    staleTime: 30_000,
  });
  // A saved statement can refer to a record outside the current results page.
  const selected = useQuery({
    queryKey: ['reportEntity', orgId, kind, value],
    queryFn: () => api.get<ReportEntity>(`/api/v1/${kind}/${value}`),
    enabled: Boolean(value) && chosen?.id !== value && !selectedName,
    staleTime: 30_000,
  });
  const name = selectedName || (chosen?.id === value ? chosen.name : selected.data?.name);
  const busy = search !== debouncedSearch || results.isFetching;
  const rows = results.data?.data ?? [];
  const pages = Math.max(1, Math.ceil((results.data?.total ?? 0) / REPORT_PICKER_PAGE_SIZE));

  useEffect(() => {
    if (!open) return;
    const outside = (event: MouseEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', outside);
    return () => document.removeEventListener('mousedown', outside);
  }, [open]);

  const choose = (entity: ReportEntity | null) => {
    setChosen(entity);
    onChange(entity?.id ?? '', entity?.name ?? '');
    setOpen(false);
    trigger.current?.focus();
  };

  return (
    <div ref={root} className={`relative ${className}`} onKeyDown={(event) => {
      if (event.key === 'Escape' && open) {
        event.stopPropagation();
        setOpen(false);
        trigger.current?.focus();
      }
    }}>
      <label id={`${id}-label`} className="block mb-2 text-sm font-semibold text-neutral-700">{label}</label>
      <button ref={trigger} type="button" aria-labelledby={`${id}-label ${id}-value`}
        aria-expanded={open} aria-controls={open ? `${id}-menu` : undefined}
        onClick={() => { setOpen(!open); setSearch(''); setPage(1); }}
        className="w-full border border-neutral-300 rounded-md px-3 min-h-10 flex items-center justify-between bg-neutral-0 text-left text-sm">
        <span id={`${id}-value`}>{name || (value ? 'Memuat pilihan...' : placeholder)}</span>
        <ChevronDown size={16} />
      </button>
      {selected.isError && value && !name && <p role="alert" className="text-sm text-danger-600">Gagal memuat pilihan. Pilih ulang atau kosongkan filter.</p>}
      {open && (
        <div id={`${id}-menu`} className="absolute z-[100] mt-1 w-full bg-neutral-0 border border-neutral-300 rounded-md shadow-lg">
          <div className="p-2 border-b border-neutral-200">
            <input autoFocus aria-label={`Cari ${label}`} placeholder="Cari nama atau kode..." value={search}
              onChange={(event) => { setSearch(event.target.value); setPage(1); }}
              className="w-full border border-neutral-300 rounded px-2 py-1.5 text-sm" />
          </div>
          <button type="button" onClick={() => choose(null)} className="w-full px-3 py-2 text-left text-sm text-neutral-500 hover:bg-neutral-50">{placeholder}</button>
          <div className="max-h-[200px] overflow-y-auto" aria-busy={busy}>
            {busy ? <div role="status" className="p-3 text-sm text-neutral-500">Memuat...</div>
              : results.isError ? <div role="alert" className="p-3 text-sm text-danger-600">
                Gagal memuat pilihan. <button type="button" className="underline" onClick={() => void results.refetch()}>Coba lagi</button>
              </div>
                : rows.length === 0 ? <div className="p-3 text-sm text-neutral-500">Tidak ada hasil.</div>
                  : rows.map((entity) => (
                    <button key={entity.id} type="button" onClick={() => choose(entity)}
                      className="block w-full px-3 py-2 text-left text-sm hover:bg-neutral-50">
                      <span className="block font-medium">{entity.name}</span>
                      <span className="block text-xs text-neutral-500">{entity.code || entity.sku}</span>
                    </button>
                  ))}
          </div>
          <div className="flex justify-between items-center border-t border-neutral-200 p-2 text-xs">
            <button type="button" disabled={busy || page <= 1} onClick={() => setPage(page - 1)} className="disabled:opacity-40">Sebelumnya</button>
            <span>Halaman {page} / {pages}</span>
            <button type="button" disabled={busy || results.isError || page >= pages} onClick={() => setPage(page + 1)} className="disabled:opacity-40">Berikutnya</button>
          </div>
        </div>
      )}
    </div>
  );
}
