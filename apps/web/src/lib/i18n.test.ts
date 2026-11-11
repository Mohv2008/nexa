import { describe, expect, it } from 'vitest';
import { t } from './i18n';

describe('internationalization', () => {
  it('returns English and Arabic interface text from the same key set', () => {
    expect(t('en', 'communities')).toBe('Communities');
    expect(t('ar', 'communities')).toBe('المجتمعات');
    expect(t('ar', 'settings')).not.toBe(t('en', 'settings'));
  });
});
