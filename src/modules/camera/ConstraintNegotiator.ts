/**
 * Negociación adaptativa multi-fase de constraints de vídeo según capabilities del hardware.
 * 
 * Estrategia optimizada (sin stream extra de probing):
 * 1. Intenta abrir stream con constraints de la fase más ambiciosa
 * 2. Si falla, degrada progresivamente (720p → 640p → 480p → 320p)
 * 3. Extrae capabilities del primer stream exitoso (sin abrir stream adicional)
 * 4. Reporta métricas de negociación para telemetría
 *
 * Solo 1 getUserMedia antes de iniciar captura real (eliminado detectDeviceCapabilities separado).
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
}

const NEGOTIATION_PHASES: NegotiationPhase[] = [
  {
    name: 'phase_1_720p_30fps',
    width: { ideal: 1280, max: 1280 },
    height: { ideal: 720, max: 720 },
    frameRate: { ideal: 30, min: 25, max: 30 },
  },
  {
    name: 'phase_2_640p_30fps',
    width: { ideal: 640, max: 960 },
    height: { ideal: 480, max: 720 },
    frameRate: { ideal: 30, min: 20, max: 30 },
  },
  {
    name: 'phase_3_480p_30fps',
    width: { ideal: 640, max: 640 },
    height: { ideal: 480, max: 480 },
    frameRate: { ideal: 30, min: 15, max: 30 },
  },
  {
    name: 'phase_4_320p_24fps_basic',
    width: { ideal: 320, max: 480 },
    height: { ideal: 240, max: 360 },
    frameRate: { ideal: 24, min: 15, max: 30 },
  },
];

/**
 * Extrae capabilities de un track ya abierto (sin stream adicional).
 */
function extractCapabilities(track: MediaStreamTrack): DeviceCapabilities {
  const defaultCaps: DeviceCapabilities = {
    maxWidth: 640,
    maxHeight: 480,
    maxFramerate: 30,
    supportsExposureMode: false,
    supportsWhiteBalanceMode: false,
    supportsFocusMode: false,
  };
  try {
    const capabilities = track.getCapabilities?.();
    if (!capabilities) return defaultCaps;
    return {
      maxWidth: capabilities.width?.max ?? 640,
      maxHeight: capabilities.height?.max ?? 480,
      maxFramerate: capabilities.frameRate?.max ?? 30,
      supportsExposureMode: (capabilities as any).exposureMode?.length > 1 || false,
      supportsWhiteBalanceMode: (capabilities as any).whiteBalanceMode?.length > 1 || false,
      supportsFocusMode: (capabilities as any).focusMode?.length > 1 || false,
    };
  } catch {
    return defaultCaps;
  }
}

/**
 * Construye constraints para una fase específica.
 */
function buildPhaseConstraints(
  phase: NegotiationPhase,
  preferredDeviceId?: string | null
): MediaTrackConstraints {
  const base: MediaTrackConstraints = {
    facingMode: { ideal: 'environment' },
  };

  if (preferredDeviceId) {
    base.deviceId = { exact: preferredDeviceId };
  }

  base.width = { ideal: phase.width.ideal, max: phase.width.max };
  base.height = { ideal: phase.height.ideal, max: phase.height.max };
  base.frameRate = {
    ideal: phase.frameRate.ideal,
    min: phase.frameRate.min,
    max: phase.frameRate.max,
  };

  return base;
}

/**
 * Negociación adaptativa multi-fase — UNA SOLA llamada a getUserMedia.
 * Intenta cada fase en orden. El primer éxito detiene la búsqueda.
 * Las capabilities se extraen del track resultante sin stream adicional.
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

  // Intentar cada fase en orden — sin stream previo de probing
  for (const phase of NEGOTIATION_PHASES) {
    metrics.phaseAttempted = phase.name;
    metrics.attempts++;
    phases.push(phase.name);

    try {
      const constraints = buildPhaseConstraints(phase, preferredDeviceId);
      const stream = await navigator.mediaDevices.getUserMedia({ video: constraints });
      const track = stream.getVideoTracks()[0];

      if (track) {
        const settings = track.getSettings();
        const capabilities = extractCapabilities(track);

        metrics.phaseSucceeded = phase.name;
        metrics.finalResolution = {
          width: settings.width ?? 640,
          height: settings.height ?? 480,
        };
        metrics.finalFramerate = settings.frameRate ?? 30;

        // Cerrar stream de prueba — CameraView abrirá el definitivo con estos constraints
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
    capabilities: {
      maxWidth: 640,
      maxHeight: 480,
      maxFramerate: 30,
      supportsExposureMode: false,
      supportsWhiteBalanceMode: false,
      supportsFocusMode: false,
    },
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
