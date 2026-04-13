import type { SpO2CalibrationCurve } from '../vital-signs/SpO2Calibrator';

export const DEVICE_PROFILE_STORAGE_KEY = 'ppg_device_profile_v2';
const STORAGE_KEY = DEVICE_PROFILE_STORAGE_KEY;

/** Huella estable por navegador/resolución (no PII). */
export function deviceFingerprint(): string {
  const nav = `${navigator.userAgent}|${screen?.width ?? 0}x${screen?.height ?? 0}`;
  let h = 2166136261;
  for (let i = 0; i < nav.length; i++) {
    h ^= nav.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return `fp_${(h >>> 0).toString(16)}`;
}

export interface DeviceProfile {
  deviceProfileId: string;
  calibrationVersion: number;
  sessionCount: number;
  /** Altura del usuario en metros (1.2–2.15); mejora proxy PWV en BloodPressureProcessorElite */
  userHeightM?: number;
  /** Sesgo medio observado en ratio-of-ratios vs población */
  opticalBiasR: number;
  /** Delta típico de intervalo de frame (ms) */
  timingBiasMs: number;
  clipBias: number;
  preferredSource: string;
  spo2Curve: Pick<SpO2CalibrationCurve, 'A' | 'B' | 'C'>;
  bpOffset: { systolic: number; diastolic: number };
  torchStabilityScore: number;
  medianRatioBehavior: number;
  ratioVarianceEma: number;
  lastUpdated: number;
}

function defaultProfile(id: string): DeviceProfile {
  return {
    deviceProfileId: id,
    calibrationVersion: 2,
    sessionCount: 0,
    opticalBiasR: 0,
    timingBiasMs: 0,
    clipBias: 0,
    preferredSource: 'RG',
    spo2Curve: { A: 104.0, B: 4.2, C: -28.5 },
    bpOffset: { systolic: 0, diastolic: 0 },
    torchStabilityScore: 0.5,
    medianRatioBehavior: 0.85,
    ratioVarianceEma: 0.02,
    lastUpdated: Date.now(),
  };
}

export class DeviceProfileManager {
  private profile: DeviceProfile;

  constructor(deviceId: string) {
    this.profile = DeviceProfileManager.load(deviceId) ?? defaultProfile(deviceId);
  }

  static load(deviceId: string): DeviceProfile | null {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      const p = JSON.parse(raw) as DeviceProfile;
      if (p.deviceProfileId !== deviceId) return null;
      return { ...defaultProfile(deviceId), ...p };
    } catch {
      return null;
    }
  }

  get(): DeviceProfile {
    return { ...this.profile };
  }

  save(partial: Partial<DeviceProfile>): void {
    this.profile = { ...this.profile, ...partial, lastUpdated: Date.now() };
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.profile));
    } catch {
      /* quota / private mode */
    }
  }

  bumpSession(): void {
    this.save({ sessionCount: this.profile.sessionCount + 1 });
  }
}
