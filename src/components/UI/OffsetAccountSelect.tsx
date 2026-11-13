import React from 'react';
import { useLanguageStore } from '../../stores/useLanguageStore';

export interface OffsetAccountOption { value: string; label: string; disabled?: boolean }
/** Keep an invalid saved selection visible; never silently replace financial intent. */
export default function OffsetAccountSelect({ value, options, onChange, disabled, className, label = 'Offset account' }: {
  value: string; options: OffsetAccountOption[]; onChange: (value: string) => void;
  disabled?: boolean; className?: string; label?: string;
}) {
  const id = useLanguageStore(s => s.language) === 'id';
  const selected = options.find(option => option.value === value);
  const invalid = !!value && (!selected || selected.disabled);
  const explanation = id ? 'Tidak dapat digunakan sebagai akun lawan. Pilih akun aktif selain kontrol piutang/utang.' : 'Cannot be used as an offset. Choose an active account other than AR/AP control.';
  return <>
    <select aria-label={label} value={value} disabled={disabled} className={className} onChange={e => onChange(e.target.value)}>
      <option value="">{id ? 'Akun bawaan' : 'Default account'}</option>
      {invalid && <option value={value} disabled>{selected?.label || value} — {explanation}</option>}
      {options.filter(option => !option.disabled).map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
    </select>
    {invalid && <span role="alert" className="block text-xs text-red-700">{explanation}</span>}
  </>;
}
