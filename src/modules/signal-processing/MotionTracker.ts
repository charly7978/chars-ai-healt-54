/**
 * Aceleración / giro — compartible entre main thread y bridge al worker.
 */

import { EWMA_DECAY_FAST } from '@/constants/processing';

export class MotionTracker {
  private motionScore = 0;
  private lastAccel = { x: 0, y: 0, z: 0 };
  private listenerActive = false;
  private readonly MOTION_THRESH = 0.6;

  private handleMotionEvent = (event: DeviceMotionEvent): void => {
    const acc = event.accelerationIncludingGravity;
    if (!acc || acc.x === null || acc.y === null || acc.z === null) return;
    const dx = (acc.x ?? 0) - this.lastAccel.x;
    const dy = (acc.y ?? 0) - this.lastAccel.y;
    const dz = (acc.z ?? 0) - this.lastAccel.z;
    this.lastAccel = { x: acc.x ?? 0, y: acc.y ?? 0, z: acc.z ?? 0 };
    const accelRMS = Math.sqrt(dx * dx + dy * dy + dz * dz);
    const rot = event.rotationRate;
    let gyroRMS = 0;
    if (rot && rot.alpha !== null && rot.beta !== null && rot.gamma !== null) {
      gyroRMS = Math.sqrt((rot.alpha ?? 0) ** 2 + (rot.beta ?? 0) ** 2 + (rot.gamma ?? 0) ** 2) / 120;
    }
    this.motionScore = this.motionScore * EWMA_DECAY_FAST + (accelRMS * 0.5 + gyroRMS * 0.3) * (1 - EWMA_DECAY_FAST);
  };

  getScore(): number {
    return this.motionScore;
  }

  getThreshold(): number {
    return this.MOTION_THRESH;
  }

  isAboveThreshold(): boolean {
    return this.motionScore > this.MOTION_THRESH;
  }

  start(): void {
    if (this.listenerActive) return;
    const g = globalThis as typeof globalThis & {
      addEventListener?: typeof window.addEventListener;
      DeviceMotionEvent?: typeof DeviceMotionEvent;
    };
    if (typeof g.addEventListener !== 'function') return;
    try {
      const DME = g.DeviceMotionEvent as (typeof DeviceMotionEvent & {
        requestPermission?: () => Promise<'granted' | 'denied' | string>;
      }) | undefined;
      if (typeof DME !== 'undefined' && typeof DME.requestPermission === 'function') {
        void DME
          .requestPermission()
          .then((state) => {
            if (state === 'granted') {
              g.addEventListener!('devicemotion', this.handleMotionEvent as EventListener, { passive: true });
              this.listenerActive = true;
            }
          })
          .catch(() => {});
      } else {
        g.addEventListener!('devicemotion', this.handleMotionEvent as EventListener, { passive: true });
        this.listenerActive = true;
      }
    } catch {
      /* no sensor */
    }
  }

  stop(): void {
    if (!this.listenerActive) return;
    const g = globalThis as typeof globalThis & { removeEventListener?: typeof window.removeEventListener };
    g.removeEventListener?.('devicemotion', this.handleMotionEvent as EventListener);
    this.listenerActive = false;
    this.motionScore = 0;
  }

  reset(): void {
    this.motionScore = 0;
    this.lastAccel = { x: 0, y: 0, z: 0 };
  }
}
