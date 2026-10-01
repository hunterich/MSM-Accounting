import { describe, expect, it } from 'vitest';
import { t } from '../strings';
import { useLanguageStore } from '../../../stores/useLanguageStore';

describe('t (i18n)', () => {
  it('keeps Bahasa Indonesia as the POS default until a language is chosen', () => {
    expect(t('checkout.pay')).toBe('Bayar');
  });
  it('returns English when locale is en', () => {
    expect(t('checkout.pay', 'en')).toBe('Pay');
  });
  it('uses the login language choice when no POS locale is passed', () => {
    useLanguageStore.setState({ language: 'en' });
    expect(t('checkout.pay')).toBe('Pay');
    useLanguageStore.setState({ language: null });
  });
  it('falls back to the key when missing', () => {
    expect(t('nonexistent.key' as never)).toBe('nonexistent.key');
  });
});
