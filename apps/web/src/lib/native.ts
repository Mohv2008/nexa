import { api } from './api';

declare global {
  interface Window {
    Capacitor?: { isNativePlatform?: () => boolean; getPlatform?: () => string };
  }
}

export async function initializeNativePush(): Promise<void> {
  if (!window.Capacitor?.isNativePlatform?.() || window.Capacitor.getPlatform?.() !== 'android')
    return;
  const { PushNotifications } = await import('@capacitor/push-notifications');
  const permission = await PushNotifications.checkPermissions();
  const result =
    permission.receive === 'prompt' ? await PushNotifications.requestPermissions() : permission;
  if (result.receive !== 'granted') return;
  await PushNotifications.addListener('registration', (token) => {
    void api('/device-tokens', {
      method: 'POST',
      body: JSON.stringify({ token: token.value, platform: 'android' }),
    });
  });
  await PushNotifications.addListener('registrationError', () => {
    // Registration can fail when a local build has no google-services.json.
  });
  await PushNotifications.register();
}
