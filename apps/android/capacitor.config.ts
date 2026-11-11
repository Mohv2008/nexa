import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'app.nexa.community',
  appName: 'NEXA',
  webDir: 'www',
  loggingBehavior: 'none',
  server: {
    androidScheme: 'https',
    hostname: 'app.nexa.example',
    cleartext: false,
    allowNavigation: [],
  },
  android: {
    allowMixedContent: false,
    captureInput: true,
    webContentsDebuggingEnabled: false,
  },
  plugins: {
    PushNotifications: {
      presentationOptions: ['badge', 'sound', 'alert'],
    },
  },
};

export default config;
