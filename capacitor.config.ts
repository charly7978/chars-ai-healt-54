import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'app.lovable.charsaihealt54',
  appName: 'chars-ai-healt-54',
  webDir: 'dist',
  server: {
    url: 'https://47bac171-d383-419e-92ab-6f1092178f39.lovableproject.com?forceHideBadge=true',
    cleartext: true
  },
  android: {
    // Keep screen on during measurements
    keepScreenOn: true,
    // Allow mixed content for camera access
    allowMixedContent: true
  },
  plugins: {
    // No additional plugin config needed — permissions are declared in the manifest
  }
};

export default config;
