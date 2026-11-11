import type { SupportedLocale } from '@nexa/shared';
import { get, writable } from 'svelte/store';

const browser = typeof window !== 'undefined';

export interface Preferences {
  theme: 'dark' | 'light' | 'system';
  locale: SupportedLocale;
  lowPower: boolean;
  compact: boolean;
  offlineCache: boolean;
}

const defaults: Preferences = {
  theme: 'dark',
  locale: 'en',
  lowPower: false,
  compact: false,
  offlineCache: true,
};

function load(): Preferences {
  if (!browser) return defaults;
  try {
    const parsed = JSON.parse(
      localStorage.getItem('nexa.preferences') ?? '{}',
    ) as Partial<Preferences>;
    return { ...defaults, ...parsed };
  } catch {
    return defaults;
  }
}

export const preferences = writable<Preferences>(load());

if (browser) {
  const syncVisibility = (): void => {
    document.documentElement.classList.toggle('page-hidden', document.hidden);
  };
  document.addEventListener('visibilitychange', syncVisibility);
  syncVisibility();
  preferences.subscribe((value) => {
    localStorage.setItem('nexa.preferences', JSON.stringify(value));
    const systemDark = matchMedia('(prefers-color-scheme: dark)').matches;
    document.documentElement.dataset.theme =
      value.theme === 'system' ? (systemDark ? 'dark' : 'light') : value.theme;
    document.documentElement.lang = value.locale;
    document.documentElement.dir = value.locale === 'ar' ? 'rtl' : 'ltr';
    document.documentElement.classList.toggle('low-power', value.lowPower);
    document.documentElement.classList.toggle('compact', value.compact);
  });
}

export function updatePreference<K extends keyof Preferences>(key: K, value: Preferences[K]): void {
  preferences.update((current) => ({ ...current, [key]: value }));
}

export function currentPreferences(): Preferences {
  return get(preferences);
}
