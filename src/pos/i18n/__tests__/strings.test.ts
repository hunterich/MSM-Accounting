import { describe, expect, it } from 'vitest';
import { t } from '../strings';

describe('t (i18n)', () => {
  it('returns Bahasa Indonesia by default', () => {
    expect(t('checkout.pay')).toBe('Bayar');
  });
  it('returns English when locale is en', () => {
    expect(t('checkout.pay', 'en')).toBe('Pay');
  });
  it('falls back to the key when missing', () => {
    expect(t('nonexistent.key' as never)).toBe('nonexistent.key');
  });
});
