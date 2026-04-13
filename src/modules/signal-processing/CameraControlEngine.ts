/**
 * Control cerrado de cámara PPG: constraints por prioridad, lectura de settings efectivos,
 * feedback anti-clipping / refuerzo de señal sin oscilación continua.
 */

export interface CameraCapabilitiesSnapshot {
  torch: boolean;
  exposureMode: string[];
  focusMode: string[];
  whiteBalanceMode: string[];
  zoom: { min: number; max: number; step: number } | null;
  iso: { min: number; max: number } | null;
  exposureCompensation: { min: number; max: number; step: number } | null;
  frameRate: { min: number; max: number } | null;
  width: { min: number; max: number } | null;
  height: { min: number; max: number } | null;
}

export interface EffectiveCameraSettings {
  width: number;
  height: number;
  frameRate: number;
  exposureMode: string;
  focusMode: string;
  whiteBalanceMode: string;
  iso: number;
  exposureCompensation: number;
  torch: boolean;
  zoom: number;
}

export class CameraControlEngine {
  private track: MediaStreamTrack | null = null;
  private lastAdjustAt = 0;
  private readonly cooldownMs = 520;
  private pendingBackoff = 0;
  private lastFeedbackKey = '';

  attachTrack(track: MediaStreamTrack | null): void {
    this.track = track;
    this.pendingBackoff = 0;
    this.lastFeedbackKey = '';
  }

  getCapabilities(): CameraCapabilitiesSnapshot | null {
    const track = this.track;
    if (!track?.getCapabilities) return null;
    const c = track.getCapabilities() as MediaTrackCapabilities & {
      torch?: boolean;
      exposureMode?: string[];
      focusMode?: string[];
      whiteBalanceMode?: string[];
    };
    return {
      torch: c.torch === true,
      exposureMode: (c.exposureMode as string[] | undefined) ?? [],
      focusMode: (c.focusMode as string[] | undefined) ?? [],
      whiteBalanceMode: (c.whiteBalanceMode as string[] | undefined) ?? [],
      zoom: c.zoom
        ? { min: c.zoom.min, max: c.zoom.max, step: c.zoom.step }
        : null,
      iso: c.iso ? { min: c.iso.min, max: c.iso.max } : null,
      exposureCompensation: c.exposureCompensation
        ? { min: c.exposureCompensation.min, max: c.exposureCompensation.max, step: c.exposureCompensation.step }
        : null,
      frameRate: c.frameRate ? { min: c.frameRate.min, max: c.frameRate.max } : null,
      width: c.width ? { min: c.width.min, max: c.width.max } : null,
      height: c.height ? { min: c.height.min, max: c.height.max } : null,
    };
  }

  getEffectiveSettings(): EffectiveCameraSettings | null {
    const track = this.track;
    if (!track?.getSettings) return null;
    const s = track.getSettings() as MediaTrackSettings & {
      exposureMode?: string;
      focusMode?: string;
      whiteBalanceMode?: string;
      exposureCompensation?: number;
      torch?: boolean;
    };
    return {
      width: s.width ?? 0,
      height: s.height ?? 0,
      frameRate: s.frameRate ?? 30,
      exposureMode: s.exposureMode ?? 'unknown',
      focusMode: s.focusMode ?? 'unknown',
      whiteBalanceMode: s.whiteBalanceMode ?? 'unknown',
      iso: s.iso ?? 0,
      exposureCompensation: s.exposureCompensation ?? 0,
      torch: s.torch === true,
      zoom: typeof s.zoom === 'number' ? s.zoom : 1,
    };
  }

  /**
   * Aplica constraints iniciales por fases con backoff si fallan.
   */
  async applyIdealConstraints(): Promise<void> {
    const track = this.track;
    if (!track?.applyConstraints) return;

    const caps = track.getCapabilities?.() as MediaTrackCapabilities & {
      torch?: boolean;
      exposureMode?: string[];
      focusMode?: string[];
      whiteBalanceMode?: string[];
    };
    if (!caps) return;

    const tryAdv = async (adv: Record<string, unknown>) => {
      try {
        await track.applyConstraints({ advanced: [adv] } as MediaTrackConstraints);
        return true;
      } catch {
        return false;
      }
    };

    const backoff = (ms: number) => new Promise((r) => setTimeout(r, ms));

    if (caps.frameRate) {
      const ok = await tryAdv({ frameRate: Math.min(30, caps.frameRate.max) });
      if (!ok) {
        this.pendingBackoff++;
        await backoff(120 + this.pendingBackoff * 80);
        await tryAdv({ frameRate: Math.min(24, caps.frameRate.max) });
      }
    }

    if (caps.torch) {
      for (let i = 0; i < 5; i++) {
        if (await tryAdv({ torch: true } as Record<string, unknown>)) break;
        await backoff(200 + i * 60);
      }
    }

    if (caps.exposureMode?.includes('continuous')) {
      await tryAdv({ exposureMode: 'continuous' });
    } else if (caps.exposureMode?.includes('manual')) {
      await tryAdv({ exposureMode: 'manual' });
    }

    if (caps.exposureCompensation) {
      const min = caps.exposureCompensation.min ?? -2;
      const max = caps.exposureCompensation.max ?? 2;
      const target = Math.max(min, Math.min(max, -0.28));
      await tryAdv({ exposureCompensation: target });
    }

    if (caps.whiteBalanceMode?.includes('continuous')) {
      await tryAdv({ whiteBalanceMode: 'continuous' });
    }

    if (caps.iso) {
      const t = Math.max(caps.iso.min, Math.min(caps.iso.max, 140));
      await tryAdv({ iso: t });
    }

    if (caps.focusMode?.includes('continuous')) {
      await tryAdv({ focusMode: 'continuous' });
    }
  }

  /**
   * Lazo cerrado suave: clipping alto baja exposición; señal débil sin clipping la sube.
   * No actúa si contacto inestable para evitar caza de ruido.
   */
  feedbackFrame(clipHigh: number, clipLow: number, signalWeak: boolean, contactUnstable: boolean): void {
    const track = this.track;
    if (!track?.applyConstraints || !track.getCapabilities) return;
    const now = performance.now();
    if (now - this.lastAdjustAt < this.cooldownMs) return;
    if (contactUnstable) return;

    const key = `${clipHigh.toFixed(2)}_${clipLow.toFixed(2)}_${signalWeak ? 1 : 0}`;
    if (key === this.lastFeedbackKey) return;
    this.lastFeedbackKey = key;

    const caps = track.getCapabilities() as MediaTrackCapabilities & { exposureCompensation?: { min: number; max: number; step: number } };
    if (!caps.exposureCompensation) return;

    const cur = track.getSettings() as MediaTrackSettings & { exposureCompensation?: number };
    const min = caps.exposureCompensation.min ?? -2;
    const max = caps.exposureCompensation.max ?? 2;
    const step = caps.exposureCompensation.step ?? 0.1;
    let ec = cur.exposureCompensation ?? 0;

    if (clipHigh > 0.34) {
      ec = Math.max(min, ec - step * 2);
    } else if (clipHigh > 0.22) {
      ec = Math.max(min, ec - step);
    } else if (clipLow > 0.28 && signalWeak) {
      ec = Math.min(max, ec + step);
    } else if (signalWeak && clipHigh < 0.12) {
      ec = Math.min(max, ec + step * 0.5);
    } else {
      return;
    }

    this.lastAdjustAt = now;
    track
      .applyConstraints({ advanced: [{ exposureCompensation: ec }] } as MediaTrackConstraints)
      .catch(() => {});
  }
}
