import React from 'react';
import { useLanguageStore } from '../../stores/useLanguageStore';
import { translate, type AppLanguage } from '../../i18n/language';

interface Props {
  className?: string;
  defaultLanguage?: AppLanguage;
}

const LanguageSelect = ({ className = '', defaultLanguage = 'en' }: Props): React.ReactElement => {
  const language = useLanguageStore((state) => state.language);
  const setLanguage = useLanguageStore((state) => state.setLanguage);
  const selected = language ?? defaultLanguage;

  return (
    <label className={`inline-flex items-center gap-2 text-sm text-neutral-700 ${className}`}>
      <span>{translate(selected, 'Language')}</span>
      <select
        aria-label={translate(selected, 'Language')}
        value={selected}
        onChange={(event) => setLanguage(event.target.value as AppLanguage)}
        className="rounded-md border border-neutral-300 bg-neutral-0 px-2 py-1.5 text-sm text-neutral-800 focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-100"
      >
        <option value="en">🇺🇸 English</option>
        <option value="id">🇮🇩 Bahasa Indonesia</option>
      </select>
    </label>
  );
};

export default LanguageSelect;
