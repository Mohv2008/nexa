import type { SupportedLocale } from '@nexa/shared';

const messages = {
  en: {
    communities: 'Communities',
    messages: 'Messages',
    feed: 'Feed',
    notifications: 'Notifications',
    settings: 'Settings',
    search: 'Search',
    members: 'Members',
    channels: 'Channels',
    voice: 'Voice',
    createServer: 'Create community',
    newMessage: 'New message',
    send: 'Send',
    loading: 'Loading',
    retry: 'Try again',
    offline: 'You are offline — showing cached content',
  },
  ar: {
    communities: 'المجتمعات',
    messages: 'الرسائل',
    feed: 'المنشورات',
    notifications: 'الإشعارات',
    settings: 'الإعدادات',
    search: 'بحث',
    members: 'الأعضاء',
    channels: 'القنوات',
    voice: 'صوت',
    createServer: 'إنشاء مجتمع',
    newMessage: 'رسالة جديدة',
    send: 'إرسال',
    loading: 'جارٍ التحميل',
    retry: 'حاول مجددًا',
    offline: 'أنت غير متصل — يتم عرض المحتوى المحفوظ',
  },
} as const;

export type TranslationKey = keyof (typeof messages)['en'];

export function t(locale: SupportedLocale, key: TranslationKey): string {
  return messages[locale][key] ?? messages.en[key];
}
