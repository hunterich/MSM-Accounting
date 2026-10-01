import { describe, expect, it } from 'vitest';
import { translate } from '../language';

describe('interface language', () => {
  it('keeps existing English text in English mode', () => {
    expect(translate('en', 'Sign in')).toBe('Sign in');
    expect(translate('en', 'Invoices')).toBe('Invoices');
  });

  it('translates login and navigation labels to Bahasa Indonesia', () => {
    expect(translate('id', 'Sign in')).toBe('Masuk');
    expect(translate('id', 'Invoices')).toBe('Faktur');
  });

  it('falls back to source text until a screen is translated', () => {
    expect(translate('id', 'Untranslated accounting label')).toBe('Untranslated accounting label');
  });
});
