/**
 * Negociación de constraints de vídeo para PPG.
 * 
 * V3 — SIN stream de prueba (getUserMedia):
 * Construye constraints directamente sin probing. La detección real de capabilities
 * la hace CameraControlEngine DESPUÉS de obtener el stream.
 * 
 * Esto evita:
 * - Doble getUserMedia (prueba + real) que falla en iOS/Android
 * - Latencia extra de 400-800ms
 * - Problemas de permisos duplicados
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

/**
 * Construye constraints optimizados para PPG SIN abrir stream de prueba.
 * Usa constraints conservadores con `ideal` (no `exact`) para máxima compatibilidad.
 * CameraControlEngine ajustará fino después con el track real.
 */
export async function buildProgressiveConstraints(
  preferredDeviceId?: string | null
): Promise<NegotiatedConstraints> {
  const t0 = performance.now();

  const video: MediaTrackConstraints = {
    facingMode: { ideal: 'environment' },
    width: { ideal: 640, max: 1280 },
    height: { ideal: 480, max: 720 },
    frameRate: { ideal: 30, min: 15, max: 60 },
  };

  if (preferredDeviceId) {
    video.deviceId = { ideal: preferredDeviceId };
  }

  const metrics: NegotiationMetrics = {
    phaseAttempted: 'direct_constraints',
    phaseSucceeded: 'direct_constraints',
    attempts: 1,
    finalResolution: null,
    finalFramerate: null,
    negotiationTimeMs: performance.now() - t0,
  };

  return {
    video,
    phases: ['direct_constraints'],
    metrics,
    capabilities: {
      maxWidth: 1280,
      maxHeight: 720,
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
