import type { DeviceProfile, DeviceProfileManager } from './DeviceProfileManager';
import { trimmedMedian } from '../vital-signs/OpticalRatioEngine';
import { EWMA_DECAY_SLOW, SPATIAL_UNIFORMITY_OPTIMAL_THRESHOLD } from '@/constants/processing';

export interface SessionOpticalStats {
  medianR: number;
  rVariance: number;
  clipHighEma: number;
  frameIntervalMs: number;
  sourceLabel: string;
}

/**
 * Aprendizaje ligero por dispositivo: sesgo óptico y varianza de R, sin ML opaco.
 */
export class DeviceCalibrationEngine {
  private rHistory: number[] = [];
  private readonly R_HIST = 40;

  constructor(
    private readonly profiles: DeviceProfileManager,
    private profile: DeviceProfile
  ) {}

  ingestFrameStats(stats: SessionOpticalStats): void {
    if (isFinite(stats.medianR) && stats.medianR > 0.1 && stats.medianR < 3) {
      this.rHistory.push(stats.medianR);
      if (this.rHistory.length > this.R_HIST) this.rHistory.shift();
    }

    const alpha = 0.05;
    const p = this.profile;
    const merged: Partial<DeviceProfile> = {
      clipBias: p.clipBias * (1 - alpha) + stats.clipHighEma * alpha,
      preferredSource: stats.sourceLabel || p.preferredSource,
      medianRatioBehavior: p.medianRatioBehavior * (1 - alpha) + stats.medianR * alpha,
      ratioVarianceEma: p.ratioVarianceEma * (1 - alpha) + stats.rVariance * alpha,
      timingBiasMs: p.timingBiasMs * (1 - alpha) + (stats.frameIntervalMs - 1000 / 30) * alpha,
    };

    if (this.rHistory.length >= 8) {
      const med = trimmedMedian(this.rHistory, 0.1);
      const popRef = SPATIAL_UNIFORMITY_OPTIMAL_THRESHOLD;
      merged.opticalBiasR = p.opticalBiasR * EWMA_DECAY_SLOW + (popRef - med) * (1 - EWMA_DECAY_SLOW);
    }

    this.profiles.save(merged);
    this.profile = this.profiles.get();
  }

  getDeviceSpO2Curve() {
    return { ...this.profile.spo2Curve };
  }

  getOpticalBiasR(): number {
    return this.profile.opticalBiasR;
  }

  getBpOffset() {
    return { ...this.profile.bpOffset };
  }

  setBpOffset(systolic: number, diastolic: number): void {
    this.profiles.save({ bpOffset: { systolic, diastolic } });
    this.profile = this.profiles.get();
  }
}
