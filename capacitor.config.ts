import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.example.charsaihealth',
  appName: 'chars-ai-health',
  webDir: 'dist',
  server: {
    androidScheme: 'https',
    cleartext: true
  },
  android: {
    allowMixedContent: true,
    buildOptions: {
      keystorePath: 'keystore.jks',
      keystoreAlias: 'key0',
      keystorePassword: '', // Deberás configurar esto
      keystorePasswordAlias: '', // Deberás configurar esto
      keystoreAliasPassword: '', // Deberás configurar esto
      keystoreType: 'jks'
    },
    appendUserAgent: 'chars-ai-health/1.0.0',
    backgroundColor: '#FFFFFF',
    allowNavigation: []
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 3000,
      launchAutoHide: true,
      backgroundColor: '#FFFFFF',
      androidSplashResourceName: 'splash',
      androidScaleType: 'CENTER_CROP',
      showSpinner: false,
      splashFullScreen: true,
      splashImmersive: true,
      layoutName: 'launch_screen',
      useDialog: false,
    },
  },
};

export default config;
