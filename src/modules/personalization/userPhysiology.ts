import { DEVICE_PROFILE_STORAGE_KEY } from '../calibration/DeviceProfileManager';

export const DEFAULT_USER_HEIGHT_M = 1.7;
export const MIN_USER_HEIGHT_M = 1.2;
export const MAX_USER_HEIGHT_M = 2.15;

/** Lee altura persistida en el perfil de dispositivo (localStorage). */
export function getUserHeightMFromStorage(): number | undefined {
  try {
    const raw = localStorage.getItem(DEVICE_PROFILE_STORAGE_KEY);
    if (!raw) return undefined;
    const p = JSON.parse(raw) as { userHeightM?: number };
    if (typeof p.userHeightM === 'number' && p.userHeightM >= MIN_USER_HEIGHT_M && p.userHeightM <= MAX_USER_HEIGHT_M) {
      return p.userHeightM;
    }
  } catch {
    /* ignore */
  }
  return undefined;
}

export function clampUserHeightM(m: number): number {
  return Math.max(MIN_USER_HEIGHT_M, Math.min(MAX_USER_HEIGHT_M, m));
}
