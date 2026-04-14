import type { FrameAnalysisResult } from './FrameAnalysisCore';
import type { PressureState } from './PressureProxyEstimator';

/**
 * Pose única de medición para PPG por cámara trasera + flash (contacto).
 *
 * Criterio de ingeniería (alineado con literatura PPG/reflectancia): una sola geometría
 * reproducible — yema cubriendo lente y flash de forma centrada, presión moderada
 * (rango óptimo de perfusión), sin “solo punta” (alta asimetría óptica / cobertura baja)
 * ni dedo aplastado (alta cobertura + pulsos atenuados / saturación).
 *
 * Sin aleatoriedad: solo umbrales sobre señales observadas en el frame.
 */
export type CanonicalPoseIssue =
  | 'OK'
  | 'TIP_ASYMMETRY'
  | 'TIP_COVERAGE'
  | 'FLAT_OVERPRESSURE'
  | 'FLAT_PERFUSION'
  | 'OFF_CENTER'
  | 'PRESSURE_LOW'
  | 'PRESSURE_HIGH';

export interface CanonicalPoseResult {
  ok: boolean;
  issue: CanonicalPoseIssue;
}

function pressureOf(a: FrameAnalysisResult): PressureState {
  return a.pressureState;
}

/**
 * Devuelve si la pose es la canónica aceptada para medir todos los biomarcadores
 * con la misma configuración de contacto.
 */
export function evaluateCanonicalPose(a: FrameAnalysisResult): CanonicalPoseResult {
  const cx = a.poseCentroidNorm.x;
  const cy = a.poseCentroidNorm.y;
  const gMag = Math.hypot(a.poseRedGradientX, a.poseRedGradientY);
  const cov = a.coverageRatio;
  const cent = a.centerCoverage;
  const su = a.spatialUniformity;
  const pi = a.perfusionIndex;
  const ch = a.clipHighRatio;

  if (pressureOf(a) === 'HIGH_PRESSURE' || ch > 0.15) {
    return { ok: false, issue: 'PRESSURE_HIGH' };
  }

  if (pressureOf(a) === 'LOW_PRESSURE') {
    return { ok: false, issue: 'PRESSURE_LOW' };
  }

  if (Math.abs(cx - 0.5) > 0.125 || Math.abs(cy - 0.5) > 0.125) {
    return { ok: false, issue: 'OFF_CENTER' };
  }

  if (gMag > 0.33) {
    return { ok: false, issue: 'TIP_ASYMMETRY' };
  }

  if (cov < 0.31 || cent < 0.14) {
    return { ok: false, issue: 'TIP_COVERAGE' };
  }

  if (cov > 0.87 && su > 0.78) {
    return { ok: false, issue: 'FLAT_OVERPRESSURE' };
  }

  if (cov > 0.74 && pi < 2.3) {
    return { ok: false, issue: 'FLAT_PERFUSION' };
  }

  if (gMag < 0.016 && cov > 0.62) {
    return { ok: false, issue: 'FLAT_OVERPRESSURE' };
  }

  if (cov > 0.84) {
    return { ok: false, issue: 'FLAT_OVERPRESSURE' };
  }

  if (pressureOf(a) !== 'OPTIMAL_PRESSURE') {
    return { ok: false, issue: 'PRESSURE_LOW' };
  }

  return { ok: true, issue: 'OK' };
}

export function canonicalPoseGuidance(issue: CanonicalPoseIssue): string {
  switch (issue) {
    case 'OK':
      return 'MANTENGA ESTA POSICIÓN — YEMA CENTRADA, PRESIÓN MODERADA';
    case 'TIP_ASYMMETRY':
      return 'BAJE LA PUNTA: USE LA YEMA COMPLETA, CENTRADA SOBRE LENTE Y FLASH (NO SOLO LA PUNTA)';
    case 'TIP_COVERAGE':
      return 'CUBRA LENTE Y FLASH CON LA YEMA — CONTACTO MÁS UNIFORME, SIN BORDE SOLO EN UN LADO';
    case 'FLAT_OVERPRESSURE':
      return 'NO APLASTE EL DEDO: LEVANTE LIGERAMENTE — YEMA SUAVE, PRESIÓN MODERADA';
    case 'FLAT_PERFUSION':
      return 'MENOS PRESIÓN: EL DEDO ESTÁ DEMASIADO APLASTADO — RELAJE HASTA VER PULSO ESTABLE';
    case 'OFF_CENTER':
      return 'CENTRE LA YEMA SOBRE LENTE Y FLASH (NO DESPLAZADA A UN LADO)';
    case 'PRESSURE_LOW':
      return 'PRESIÓN MODERADA Y UNIFORME — SIN APLASTAR; APRIETE UN POCO MÁS CON LA YEMA';
    case 'PRESSURE_HIGH':
      return 'SUELTE PRESIÓN: DEMASIADO FUERTE — USE SOLO FIRMEZA MODERADA CON LA YEMA';
    default:
      return 'AJUSTE LA YEMA: CENTRADA, PRESIÓN MODERADA, SIN PUNTA NI APLASTAMIENTO';
  }
}
