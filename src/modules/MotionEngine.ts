/**
 * MOTION ENGINE — Detección de artefactos de movimiento via IMU + visual.
 */
import { PPG_CONFIG } from '../config/ppgConfig';
import type { MotionState, MotionResult } from '../types/ppg-types';

const M = PPG_CONFIG.motion;

export class MotionEngine {
  private score = 0;
  private lastAccel = { x: 0, y: 0, z: 0 };
  private imuActive = false;
  private episodes: number[] = [];

  // Visual motion
  private lastFrameBrightness = 0;
  private visualMotionScore = 0;

  start(): void {
    if (this.imuActive) return;
    try {
      if (typeof DeviceMotionEvent !== 'undefined') {
        if (typeof (DeviceMotionEvent as any).requestPermission === 'function') {
          (DeviceMotionEvent as any).requestPermission()
            .then((state: string) => {
              if (state === 'granted') {
                window.addEventListener('devicemotion', this.handleMotion, { passive: true });
                this.imuActive = true;
              }
            }).catch(() => {});
        } else {
          window.addEventListener('devicemotion', this.handleMotion, { passive: true });
          this.imuActive = true;
        }
      }
    } catch {}
  }

  stop(): void {
    if (this.imuActive) {
      window.removeEventListener('devicemotion', this.handleMotion);
      this.imuActive = false;
    }
    this.score = 0;
  }

  /**
   * Update visual motion from frame brightness delta
   */
  updateVisual(brightness: number): void {
    if (this.lastFrameBrightness > 0) {
      const diff = Math.abs(brightness - this.lastFrameBrightness);
      const normalized = diff / Math.max(1, this.lastFrameBrightness);
      this.visualMotionScore = this.visualMotionScore * 0.85 + normalized * 100 * 0.15;
    }
    this.lastFrameBrightness = brightness;
  }

  getResult(): MotionResult {
    const combined = this.imuActive
      ? this.score * 0.7 + this.visualMotionScore * 0.3
      : this.visualMotionScore;

    let state: MotionState;
    if (combined < M.threshold * 0.5) state = 'STILL';
    else if (combined < M.threshold) state = 'SLIGHT';
    else if (combined < M.highThreshold) state = 'MODERATE';
    else state = 'HIGH';

    return { score: combined, state, episodes: [...this.episodes] };
  }

  getScore(): number {
    return this.imuActive
      ? this.score * 0.7 + this.visualMotionScore * 0.3
      : this.visualMotionScore;
  }

  reset(): void {
    this.score = 0;
    this.visualMotionScore = 0;
    this.lastFrameBrightness = 0;
    this.episodes = [];
  }

  private handleMotion = (e: DeviceMotionEvent) => {
    const acc = e.accelerationIncludingGravity;
    if (!acc || acc.x === null) return;

    const dx = (acc.x ?? 0) - this.lastAccel.x;
    const dy = (acc.y ?? 0) - this.lastAccel.y;
    const dz = (acc.z ?? 0) - this.lastAccel.z;
    this.lastAccel = { x: acc.x ?? 0, y: acc.y ?? 0, z: acc.z ?? 0 };

    const accelRMS = Math.sqrt(dx * dx + dy * dy + dz * dz);
    const rot = e.rotationRate;
    let gyroRMS = 0;
    if (rot && rot.alpha !== null) {
      gyroRMS = Math.sqrt((rot.alpha ?? 0) ** 2 + (rot.beta ?? 0) ** 2 + (rot.gamma ?? 0) ** 2) / 120;
    }

    const raw = accelRMS * M.accelWeight + gyroRMS * M.gyroWeight;
    this.score = this.score * (1 - M.smoothingAlpha) + raw * M.smoothingAlpha;

    if (this.score > M.highThreshold) {
      this.episodes.push(Date.now());
      if (this.episodes.length > 100) this.episodes.shift();
    }
  };
}
