import { useEffect, useRef, useCallback } from 'react';

/**
 * Hook de detección de artefactos por movimiento usando DeviceMotion API
 * 
 * Calcula un score de movimiento (0-1) basado en acelerómetro + giroscopio.
 * Cuando el movimiento excede el umbral, marca la ventana como inválida.
 * 
 * Referencia: Maeda et al. 2011 - Motion artifact removal in PPG
 */

export interface MotionState {
  /** Score de movimiento 0-1 (0=quieto, 1=mucho movimiento) */
  motionScore: number;
  /** Si la ventana actual tiene artefactos de movimiento */
  hasMotionArtifact: boolean;
  /** Aceleración lineal RMS (m/s²) */
  accelerationRMS: number;
  /** Velocidad angular RMS (rad/s) */
  rotationRMS: number;
  /** Si el sensor está disponible */
  isAvailable: boolean;
}

const MOTION_THRESHOLD = 0.35;         // Score arriba del cual hay artefacto
const ACCEL_WEIGHT = 0.6;              // Peso de aceleración en score final
const GYRO_WEIGHT = 0.4;               // Peso de giroscopio
const ACCEL_NORMALIZATION = 3.0;       // m/s² para normalizar a 0-1
const GYRO_NORMALIZATION = 1.5;        // rad/s para normalizar a 0-1
const SMOOTHING_ALPHA = 0.15;          // EMA para suavizar score
const WINDOW_SIZE = 30;                // Muestras en ventana (~500ms a 60Hz)
const ARTIFACT_HOLD_FRAMES = 15;       // Mantener artefacto N frames después de movimiento

export const useMotionDetector = () => {
  const stateRef = useRef<MotionState>({
    motionScore: 0,
    hasMotionArtifact: false,
    accelerationRMS: 0,
    rotationRMS: 0,
    isAvailable: false,
  });

  const accelBufferRef = useRef<number[]>([]);
  const gyroBufferRef = useRef<number[]>([]);
  const smoothScoreRef = useRef(0);
  const artifactHoldRef = useRef(0);

  useEffect(() => {
    if (!('DeviceMotionEvent' in window)) {
      console.log('⚠️ DeviceMotion API no disponible');
      return;
    }

    // iOS 13+ requiere permiso
    const requestPermission = async () => {
      try {
        const DM = DeviceMotionEvent as any;
        if (typeof DM.requestPermission === 'function') {
          const perm = await DM.requestPermission();
          if (perm !== 'granted') {
            console.log('⚠️ Permiso DeviceMotion denegado');
            return false;
          }
        }
        return true;
      } catch {
        return true; // Continuar en Android/Desktop
      }
    };

    const handleMotion = (event: DeviceMotionEvent) => {
      const accel = event.accelerationIncludingGravity;
      const rotRate = event.rotationRate;

      // Aceleración lineal (restar gravedad aproximada)
      // Usar acceleration sin gravedad si está disponible, sino estimar
      const ax = event.acceleration?.x ?? (accel?.x ?? 0);
      const ay = event.acceleration?.y ?? (accel?.y ?? 0);
      const az = event.acceleration?.z ?? (accel?.z ?? 0);
      const accelMag = Math.sqrt(ax * ax + ay * ay + az * az);

      // Rotación
      const rx = (rotRate?.alpha ?? 0) * (Math.PI / 180); // deg/s → rad/s
      const ry = (rotRate?.beta ?? 0) * (Math.PI / 180);
      const rz = (rotRate?.gamma ?? 0) * (Math.PI / 180);
      const gyroMag = Math.sqrt(rx * rx + ry * ry + rz * rz);

      // Buffers circulares
      const ab = accelBufferRef.current;
      const gb = gyroBufferRef.current;
      ab.push(accelMag);
      gb.push(gyroMag);
      if (ab.length > WINDOW_SIZE) ab.shift();
      if (gb.length > WINDOW_SIZE) gb.shift();

      // RMS sobre ventana
      const accelRMS = Math.sqrt(ab.reduce((s, v) => s + v * v, 0) / ab.length);
      const gyroRMS = Math.sqrt(gb.reduce((s, v) => s + v * v, 0) / gb.length);

      // Normalizar a 0-1
      const accelNorm = Math.min(1, accelRMS / ACCEL_NORMALIZATION);
      const gyroNorm = Math.min(1, gyroRMS / GYRO_NORMALIZATION);

      // Score combinado
      const rawScore = accelNorm * ACCEL_WEIGHT + gyroNorm * GYRO_WEIGHT;

      // Suavizar con EMA
      smoothScoreRef.current = smoothScoreRef.current * (1 - SMOOTHING_ALPHA) + rawScore * SMOOTHING_ALPHA;
      const score = smoothScoreRef.current;

      // Determinar artefacto con hold (histéresis temporal)
      let hasArtifact: boolean;
      if (score > MOTION_THRESHOLD) {
        hasArtifact = true;
        artifactHoldRef.current = ARTIFACT_HOLD_FRAMES;
      } else if (artifactHoldRef.current > 0) {
        hasArtifact = true;
        artifactHoldRef.current--;
      } else {
        hasArtifact = false;
      }

      stateRef.current = {
        motionScore: Math.round(score * 1000) / 1000,
        hasMotionArtifact: hasArtifact,
        accelerationRMS: Math.round(accelRMS * 100) / 100,
        rotationRMS: Math.round(gyroRMS * 100) / 100,
        isAvailable: true,
      };
    };

    requestPermission().then(granted => {
      if (granted) {
        window.addEventListener('devicemotion', handleMotion, { passive: true });
        stateRef.current.isAvailable = true;
        console.log('✅ DeviceMotion activado para detección de artefactos');
      }
    });

    return () => {
      window.removeEventListener('devicemotion', handleMotion);
    };
  }, []);

  const getMotionState = useCallback((): MotionState => {
    return stateRef.current;
  }, []);

  return { getMotionState };
};
