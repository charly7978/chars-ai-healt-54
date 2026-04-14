/**
 * Negociación progresiva de constraints de vídeo (reutilizable desde CameraView).
 */

export type NegotiatedConstraints = {
  video: MediaTrackConstraints;
  phases: string[];
};

export function buildProgressiveConstraints(preferredDeviceId?: string | null): NegotiatedConstraints {
  const phases: string[] = [];
  const base: MediaTrackConstraints = preferredDeviceId
    ? {
        deviceId: { exact: preferredDeviceId },
        width: { ideal: 640, max: 960 },
        height: { ideal: 480, max: 720 },
        frameRate: { ideal: 30, min: 20, max: 30 },
        facingMode: { ideal: 'environment' },
      }
    : {
        facingMode: { ideal: 'environment' },
        width: { ideal: 640, max: 960 },
        height: { ideal: 480, max: 720 },
        frameRate: { ideal: 30, min: 20, max: 30 },
      };
  phases.push('base_environment_640p_30fps');
  return { video: base, phases };
}

export function fallbackConstraints(): MediaTrackConstraints {
  return {
    facingMode: { ideal: 'environment' },
    width: { ideal: 640 },
    height: { ideal: 480 },
  };
}
