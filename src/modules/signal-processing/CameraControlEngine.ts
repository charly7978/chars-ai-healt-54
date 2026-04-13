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

/**
 * Capabilities con extensiones no tipadas al completo en lib.dom
 * (zoom, ISO, compensación de exposición en Image Capture / móvil).
 */
type ExtendedMediaTrackCapabilities = MediaTrackCapabilities & {
  torch?: boolean;
  exposureMode?: string[];
  focusMode?: string[];
  whiteBalanceMode?: string[];
  zoom?: { min: number; max: number; step: number };
  iso?: { min: number; max: number };
  exposureCompensation?: { min: number; max: number; step: number };
};

type ExtendedMediaTrackSettings = MediaTrackSettings & {
  exposureMode?: string;
  focusMode?: string;
  whiteBalanceMode?: string;
  exposureCompensation?: number;
  torch?: boolean;
  iso?: number;
  zoom?: number;
};

export class CameraControlEngine {
  private track: MediaStreamTrack | null = null;
  private lastAdjustAt = 0;
  private readonly cooldownMs = 520;
  private pendingBackoff = 0;
  private lastFeedbackKey = '';
  /** Frames consecutivos con clipping alto (zoom de emergencia) */
  private highClipStreak = 0;
  /** Último snapshot tras intento de feedback (lectura real del track) */
  private lastFeedbackEffective: EffectiveCameraSettings | null = null;

  attachTrack(track: MediaStreamTrack | null): void {
    this.track = track;
    this.pendingBackoff = 0;
    this.lastFeedbackKey = '';
    this.highClipStreak = 0;
    this.lastFeedbackEffective = null;
  }

  /** Settings leídos tras el último ajuste por feedback (puede ser null). */
  getLastFeedbackEffective(): EffectiveCameraSettings | null {
    return this.lastFeedbackEffective;
  }

  getCapabilities(): CameraCapabilitiesSnapshot | null {
    const track = this.track;
    if (!track?.getCapabilities) return null;
    const c = track.getCapabilities() as ExtendedMediaTrackCapabilities;
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
    const s = track.getSettings() as ExtendedMediaTrackSettings;
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
   * Devuelve lista de fases aplicadas con éxito (telemetría).
   */
  async applyIdealConstraints(): Promise<string[]> {
    const phases: string[] = [];
    const track = this.track;
    if (!track?.applyConstraints) return phases;

    const caps = track.getCapabilities?.() as ExtendedMediaTrackCapabilities;
    if (!caps) return phases;

    const tryAdv = async (adv: Record<string, unknown>, label: string) => {
      try {
        await track.applyConstraints({ advanced: [adv] } as MediaTrackConstraints);
        phases.push(label);
        return true;
      } catch {
        return false;
      }
    };

    const backoff = (ms: number) => new Promise((r) => setTimeout(r, ms));

    if (caps.frameRate) {
      const maxF = caps.frameRate.max;
      let ok = await tryAdv({ frameRate: Math.min(60, maxF) }, 'frameRate_max60');
      if (!ok) {
        ok = await tryAdv({ frameRate: Math.min(30, maxF) }, 'frameRate_max30');
      }
      if (!ok) {
        this.pendingBackoff++;
        await backoff(120 + this.pendingBackoff * 80);
        await tryAdv({ frameRate: Math.min(24, maxF) }, 'frameRate_max24');
      }
    }

    if (caps.torch) {
      for (let i = 0; i < 5; i++) {
        if (await tryAdv({ torch: true } as Record<string, unknown>, 'torch_on')) break;
        await backoff(200 + i * 60);
      }
    }

    if (caps.exposureMode?.includes('continuous')) {
      await tryAdv({ exposureMode: 'continuous' }, 'exposure_continuous');
    } else if (caps.exposureMode?.includes('manual')) {
      await tryAdv({ exposureMode: 'manual' }, 'exposure_manual');
    }

    if (caps.exposureCompensation) {
      const min = caps.exposureCompensation.min ?? -2;
      const max = caps.exposureCompensation.max ?? 2;
      const target = Math.max(min, Math.min(max, -0.28));
      await tryAdv({ exposureCompensation: target }, 'exposureCompensation');
    }

    if (caps.whiteBalanceMode?.includes('continuous')) {
      await tryAdv({ whiteBalanceMode: 'continuous' }, 'wb_continuous');
    }

    if (caps.iso) {
      const t = Math.max(caps.iso.min, Math.min(caps.iso.max, 140));
      await tryAdv({ iso: t }, 'iso');
    }

    if (caps.focusMode?.includes('continuous')) {
      await tryAdv({ focusMode: 'continuous' }, 'focus_continuous');
    }

    return phases;
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

    if (clipHigh > 0.36) this.highClipStreak = Math.min(this.highClipStreak + 1, 30);
    else this.highClipStreak = Math.max(0, this.highClipStreak - 2);

    const key = `${clipHigh.toFixed(2)}_${clipLow.toFixed(2)}_${signalWeak ? 1 : 0}`;
    if (key === this.lastFeedbackKey) return;

    const caps = track.getCapabilities() as ExtendedMediaTrackCapabilities;

    const tryZoomOut = (): boolean => {
      if (!caps.zoom || this.highClipStreak < 6 || clipHigh < 0.32) return false;
      const cur = track.getSettings() as MediaTrackSettings & { zoom?: number };
      const z = typeof cur.zoom === 'number' ? cur.zoom : 1;
      const zMin = caps.zoom.min;
      const step = caps.zoom.step || 0.1;
      if (z <= zMin + 1e-4) return false;
      const nz = Math.max(zMin, z - Math.max(step, 0.05) * 3);
      this.lastFeedbackKey = `zoom_${nz.toFixed(3)}`;
      this.lastAdjustAt = now;
      void track
        .applyConstraints({ advanced: [{ zoom: nz }] } as unknown as MediaTrackConstraints)
        .then(() => {
          this.lastFeedbackEffective = this.getEffectiveSettings();
        })
        .catch(() => {});
      return true;
    };

    if (!caps.exposureCompensation) {
      tryZoomOut();
      return;
    }

    this.lastFeedbackKey = key;

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
      if (clipHigh > 0.28) tryZoomOut();
      return;
    }

    this.lastAdjustAt = now;
    void track
      .applyConstraints({ advanced: [{ exposureCompensation: ec }] } as unknown as MediaTrackConstraints)
      .then(() => {
        this.lastFeedbackEffective = this.getEffectiveSettings();
      })
      .catch(() => {});
  }
}