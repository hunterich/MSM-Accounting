import React from 'react';

interface BadgeStyle { label: string; pill: string; dot: string }

const STYLES: Record<string, BadgeStyle> = {
  OBAT_BEBAS:          { label: 'Bebas',       pill: 'bg-green-50 text-green-800', dot: 'bg-green-500' },
  OBAT_BEBAS_TERBATAS: { label: 'Terbatas',    pill: 'bg-blue-50 text-blue-800',   dot: 'bg-blue-500' },
  OBAT_KERAS:          { label: 'Keras',       pill: 'bg-red-50 text-red-800',     dot: 'bg-red-500' },
  PSIKOTROPIKA:        { label: 'Psikotropika', pill: 'bg-red-50 text-red-800',    dot: 'bg-red-500' },
  NARKOTIKA:           { label: 'Narkotika',   pill: 'bg-red-50 text-red-800',     dot: 'bg-red-500' },
  NON_OBAT:            { label: 'Umum',        pill: 'bg-gray-100 text-gray-600',  dot: 'bg-gray-400' },
};

const FALLBACK: BadgeStyle = { label: 'Umum', pill: 'bg-gray-100 text-gray-600', dot: 'bg-gray-400' };

export default function DrugClassBadge({ drugClass }: { drugClass: string }): React.ReactElement {
  const s = STYLES[drugClass] ?? FALLBACK;
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${s.pill}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${s.dot}`} />
      {s.label}
    </span>
  );
}
