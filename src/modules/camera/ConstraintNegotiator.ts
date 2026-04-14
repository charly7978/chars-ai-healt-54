/**
 * Negociación adaptativa multi-fase de constraints de vídeo según capabilities del hardware.
 * Basado en WebRTC standards y literatura 2024 sobre adaptive camera constraints.
 * 
 * Estrategia:
 * 1. Detección de capabilities del dispositivo (resolución, framerate, exposure)
 * 2. Negociación progresiva de 5 fases (alta → media → baja, framerate, exposure)
 * 3. Fallback inteligente con métricas de éxito
 * 4. Exposición adaptativa para optimizar señal PPG
 */

export interface DeviceCapabilities {
  maxWidth: number;
  maxHeight: number;
  maxFramerate: number;
  supportsExposureMode: boolean;
  supportsWhiteBalanceMode: boolean;
  supportsFocusMode: boolean;
}

export interface NegotiationMetrics {
  phaseAttempted: string;
  phaseSucceeded: string;
  attempts: number;
  finalResolution: { width: number; height: number } | null;
  finalFramerate: number | null;
  negotiationTimeMs: number;
}

export type NegotiatedConstraints = {
  video: MediaTrackConstraints;
  phases: string[];
  metrics?: NegotiationMetrics;
  capabilities?: DeviceCapabilities;
};

/** Fases de negociación en orden de prioridad (alta calidad → fallback) */
interface NegotiationPhase {
  name: string;
  width: { ideal: number; max: number };
  height: { ideal: number; max: number };
  frameRate: { ideal: number; min?: number; max?: number };
  exposureMode?: string;
  exposureCompensation?: number;
  whiteBalanceMode?: string;
}

const NEGOTIATION_PHASES: NegotiationPhase[] = [
  {
    name: 'phase_1_1080p_30fps_exposure_adaptive',
    width: { ideal: 1920, max: 1920 },
    height: { ideal: 1080, max: 1080 },
    frameRate: { ideal: 30, min: 25, max: 30 },
    exposureMode: 'continuous',
    exposureCompensation: 0,
    whiteBalanceMode: 'continuous',
  },
  {
    name: 'phase_2_720p_30fps_exposure_adaptive',
    width: { ideal: 1280, max: 1280 },
    height: { ideal: 720, max: 720 },
    frameRate: { ideal: 30, min: 25, max: 30 },
    exposureMode: 'continuous',
    exposureCompensation: 0,
    whiteBalanceMode: 'continuous',
  },
  {
    name: 'phase_3_640p_30fps_exposure_adaptive',
    width: { ideal: 640, max: 960 },
    height: { ideal: 480, max: 720 },
    frameRate: { ideal: 30, min: 20, max: 30 },
    exposureMode: 'continuous',
    exposureCompensation: 0,
    whiteBalanceMode: 'continuous',
  },
  {
    name: 'phase_4_480p_30fps_exposure_auto',
    width: { ideal: 640, max: 640 },
    height: { ideal: 480, max: 480 },
    frameRate: { ideal: 30, min: 15, max: 30 },
    exposureMode: 'continuous',
    whiteBalanceMode: 'continuous',
  },
  {
    name: 'phase_5_320p_24fps_basic',
    width: { ideal: 320, max: 480 },
    height: { ideal: 240, max: 360 },
    frameRate: { ideal: 24, min: 15, max: 30 },
  },
];

/**
 * Detecta capabilities del dispositivo mediante probing de constraints.
 * Sin simulación: usa MediaDevices API real.
 */
async function detectDeviceCapabilities(preferredDeviceId?: string | null): Promise<DeviceCapabilities> {
  const constraints: MediaStreamConstraints = {
    video: {
      deviceId: preferredDeviceId ? { exact: preferredDeviceId } : undefined,
      facingMode: { ideal: 'environment' },
      width: { ideal: 1920 },
      height: { ideal: 1080 },
      frameRate: { ideal: 30 },
    },
  };

  try {
    const stream = await navigator.mediaDevices.getUserMedia(constraints);
    const track = stream.getVideoTracks()[0];
    if (!track) {
      stream.getTracks().forEach(t => t.stop());
      return { maxWidth: 640, maxHeight: 480, maxFramerate: 30, supportsExposureMode: false, supportsWhiteBalanceMode: false, supportsFocusMode: false };
    }

    const settings = track.getSettings();
    const capabilities = track.getCapabilities ? track.getCapabilities() : null;

    const caps: DeviceCapabilities = {
      maxWidth: capabilities?.width?.max ?? 640,
      maxHeight: capabilities?.height?.max ?? 480,
      maxFramerate: capabilities?.frameRate?.max ?? 30,
      supportsExposureMode: capabilities?.exposureMode?.length ? capabilities.exposureMode.length > 1 : false,
      supportsWhiteBalanceMode: capabilities?.whiteBalanceMode?.length ? capabilities.whiteBalanceMode.length > 1 : false,
      supportsFocusMode: capabilities?.focusMode?.length ? capabilities.focusMode.length > 1 : false,
    };

    stream.getTracks().forEach(t => t.stop());
    return caps;
  } catch {
    return { maxWidth: 640, maxHeight: 480, maxFramerate: 30, supportsExposureMode: false, supportsWhiteBalanceMode: false, supportsFocusMode: false };
  }
}

/**
 * Construye constraints para una fase específica, ajustando según capabilities.
 */
function buildPhaseConstraints(
  phase: NegotiationPhase,
  capabilities: DeviceCapabilities,
  preferredDeviceId?: string | null
): MediaTrackConstraints {
  const base: MediaTrackConstraints = {
    facingMode: { ideal: 'environment' },
  };

  if (preferredDeviceId) {
    base.deviceId = { exact: preferredDeviceId };
  }

  // Ajustar resolución según capabilities del dispositivo
  const targetWidth = Math.min(phase.width.ideal, capabilities.maxWidth);
  const targetHeight = Math.min(phase.height.ideal, capabilities.maxHeight);
  const targetFramerate = Math.min(phase.frameRate.ideal, capabilities.maxFramerate);

  base.width = {
    ideal: targetWidth,
    max: Math.min(phase.width.max, capabilities.maxWidth),
  };
  base.height = {
    ideal: targetHeight,
    max: Math.min(phase.height.max, capabilities.maxHeight),
  };
  base.frameRate = {
    ideal: targetFramerate,
    min: phase.frameRate.min,
    max: Math.min(phase.frameRate.max ?? targetFramerate, capabilities.maxFramerate),
  };

  // Añadir modo de exposición si el dispositivo lo soporta (propiedad no estándar)
  if (capabilities.supportsExposureMode && phase.exposureMode) {
    (base as any).exposureMode = { ideal: phase.exposureMode };
    if (phase.exposureCompensation !== undefined) {
      (base as any).exposureCompensation = { ideal: phase.exposureCompensation };
    }
  }

  // Añadir modo de balance de blancos si el dispositivo lo soporta (propiedad no estándar)
  if (capabilities.supportsWhiteBalanceMode && phase.whiteBalanceMode) {
    (base as any).whiteBalanceMode = { ideal: phase.whiteBalanceMode };
  }

  return base;
}

/**
 * Negociación adaptativa multi-fase.
 * Intenta cada fase en orden hasta que una tenga éxito.
 */
export async function buildProgressiveConstraints(
  preferredDeviceId?: string | null
): Promise<NegotiatedConstraints> {
  const t0 = performance.now();
  const phases: string[] = [];
  const metrics: NegotiationMetrics = {
    phaseAttempted: '',
    phaseSucceeded: '',
    attempts: 0,
    finalResolution: null,
    finalFramerate: null,
    negotiationTimeMs: 0,
  };

  // Detectar capabilities del dispositivo
  const capabilities = await detectDeviceCapabilities(preferredDeviceId);

  // Intentar cada fase en orden
  for (const phase of NEGOTIATION_PHASES) {
    metrics.phaseAttempted = phase.name;
    metrics.attempts++;
    phases.push(phase.name);

    try {
      const constraints = buildPhaseConstraints(phase, capabilities, preferredDeviceId);
      const stream = await navigator.mediaDevices.getUserMedia({ video: constraints });
      const track = stream.getVideoTracks()[0];

      if (track) {
        const settings = track.getSettings();
        metrics.phaseSucceeded = phase.name;
        metrics.finalResolution = {
          width: settings.width ?? 640,
          height: settings.height ?? 480,
        };
        metrics.finalFramerate = settings.frameRate ?? 30;

        stream.getTracks().forEach(t => t.stop());
        metrics.negotiationTimeMs = performance.now() - t0;

        return {
          video: constraints,
          phases,
          metrics,
          capabilities,
        };
      }

      stream.getTracks().forEach(t => t.stop());
    } catch {
      continue;
    }
  }

  // Si todas las fases fallaron, usar fallback básico
  metrics.phaseAttempted = 'fallback_basic';
  metrics.attempts++;
  phases.push('fallback_basic');
  metrics.negotiationTimeMs = performance.now() - t0;

  return {
    video: fallbackConstraints(),
    phases,
    metrics,
    capabilities,
  };
}

export function fallbackConstraints(): MediaTrackConstraints {
  return {
    facingMode: { ideal: 'environment' },
    width: { ideal: 320, max: 640 },
    height: { ideal: 240, max: 480 },
    frameRate: { ideal: 24, min: 15, max: 30 },
  };
}

/**
 * Constraints optimizados para PPG con flash activo.
 * Prioriza framerate estable sobre resolución alta.
 */
export function buildPPGOptimizedConstraints(preferredDeviceId?: string | null): MediaTrackConstraints {
  const base: MediaTrackConstraints = {
    facingMode: { ideal: 'environment' },
    width: { ideal: 640, max: 960 },
    height: { ideal: 480, max: 720 },
    frameRate: { ideal: 30, min: 25, max: 30 },
  };

  if (preferredDeviceId) {
    base.deviceId = { exact: preferredDeviceId };
  }

  return base;
}
