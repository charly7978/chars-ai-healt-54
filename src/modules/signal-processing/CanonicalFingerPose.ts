import type { FrameAnalysisResult } from './FrameAnalysisCore';
import type { PressureState } from './PressureProxyEstimator';

/**
 * Pose de medición para PPG (cámara trasera + flash).
 *
 * - **Estricta**: yema centrada, poca asimetría (referencia reproducible).
 * - **Lateral óptica** (fallback): contacto lateral válido cuando la señal es
 *   estable (maskIoU, perfusión, cromática) aunque el centroide y los gradientes
 *   R indiquen dedo “de costado” — mismo tejido, distinta geometría respecto al
 *   flash; sin simulación, solo reglas sobre métricas del frame.
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

/** Pose frontal “libro”: centroide cerca del eje óptico y gradientes moderados. */
function evaluateStrictCanonical(a: FrameAnalysisResult): CanonicalPoseResult {
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

  if (Math.abs(cx - 0.5) > 0.19 || Math.abs(cy - 0.5) > 0.19) {
    return { ok: false, issue: 'OFF_CENTER' };
  }

  if (gMag > 0.42) {
    return { ok: false, issue: 'TIP_ASYMMETRY' };
  }

  if (cov < 0.28 || cent < 0.12) {
    return { ok: false, issue: 'TIP_COVERAGE' };
  }

  if (cov > 0.87 && su > 0.78) {
    return { ok: false, issue: 'FLAT_OVERPRESSURE' };
  }

  if (cov > 0.76 && pi < 2.05) {
    return { ok: false, issue: 'FLAT_PERFUSION' };
  }

  if (gMag < 0.014 && cov > 0.62) {
    return { ok: false, issue: 'FLAT_OVERPRESSURE' };
  }

  if (cov > 0.88) {
    return { ok: false, issue: 'FLAT_OVERPRESSURE' };
  }

  if (pressureOf(a) !== 'OPTIMAL_PRESSURE') {
    return { ok: false, issue: 'PRESSURE_LOW' };
  }

  return { ok: true, issue: 'OK' };
}

/**
 * Contacto lateral: centroide desplazado y/o gradiente R alto son normales;
 * exigimos estabilidad de máscara, perfusión y consistencia cromática (R/G/B).
 */
function evaluateLateralOpticalPose(a: FrameAnalysisResult): boolean {
  if (a.pressureState !== 'OPTIMAL_PRESSURE') return false;
  if (a.clipHighRatio > 0.18) return false;
  if ((a.maskIoU ?? 0) < 0.18) return false;
  if (a.perfusionIndex < 1.45) return false;
  if (a.coverageRatio < 0.24 || a.centerCoverage < 0.09) return false;

  const cx = a.poseCentroidNorm.x;
  const cy = a.poseCentroidNorm.y;
  if (Math.abs(cx - 0.5) > 0.42 || Math.abs(cy - 0.5) > 0.42) return false;

  const gMag = Math.hypot(a.poseRedGradientX, a.poseRedGradientY);
  if (gMag > 0.74 || gMag < 0.006) return false;

  const rr = a.rawRed;
  const gg = a.rawGreen;
  const bb = a.rawBlue;
  if (rr < 42 || gg < 6 || rr / Math.max(gg, 1) < 1.02) return false;
  if (bb > 3 && rr / bb < 1.008) return false;

  const su = a.spatialUniformity;
  if (su < 0.11 || su > 0.94) return false;

  if (a.coverageRatio > 0.92 && su > 0.84 && a.perfusionIndex < 1.95) {
    return false;
  }

  return true;
}

export function evaluateCanonicalPose(a: FrameAnalysisResult): CanonicalPoseResult {
  const strict = evaluateStrictCanonical(a);
  if (strict.ok) return strict;

  if (evaluateLateralOpticalPose(a)) {
    return { ok: true, issue: 'OK' };
  }

  return strict;
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
      return 'AJUSTE LA YEMA: CENTRADA O DE COSTADO FIRME, PRESIÓN MODERADA, SIN APLASTAMIENTO';
  }
}
