import type { BeatFlags } from '@/types/beat';

/** Clase visual del trazo PPG por latido (monitor). */
export type BeatWaveClass = 'normal' | 'weak' | 'arrhythmia';

/** Por debajo de esto (0–100) la morfología se considera “débil” si no hay arritmia. */
export const MORPHOLOGY_WEAK_BELOW = 46;

function medianSorted(sorted: number[]): number {
  if (sorted.length === 0) return 0;
  const m = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[m]! : (sorted[m - 1]! + sorted[m]!) / 2;
}

/** Último RR atípico respecto a la mediana de los anteriores (ritmo irregular local). */
export function isLastRROutlier(rrs: number[], relDev = 0.14): boolean {
  if (!rrs || rrs.length < 2) return false;
  const last = rrs[rrs.length - 1]!;
  const prev = rrs.slice(0, -1);
  const sorted = [...prev].sort((a, b) => a - b);
  const med = medianSorted(sorted);
  if (med <= 0) return false;
  return Math.abs(last - med) / med > relDev;
}

/**
 * Señales fuertes a nivel de latido desde el detector (prematuro, doble, inserción).
 */
export function beatFlagsSuggestArrhythmia(flags: BeatFlags | null): boolean {
  if (!flags) return false;
  // SOLO usar isPremature para arritmia - más conservador
  return !!flags.isPremature;
}

export type RhythmPanel = { isAlert: boolean; count: number };

/**
 * Combina flags de latido + panel de ritmo + RR para decidir si este latido se pinta como “A”.
 * Evita pintar todo en rojo solo por etiqueta global si el RR actual es estable.
 */
export function shouldPaintBeatAsArrhythmic(
  flags: BeatFlags | null,
  rhythm: RhythmPanel,
  rrIntervals: number[],
  lastRhythmCountSeen: number
): { arrhythmic: boolean; lastRhythmCountSeen: number } {
  let nextSeen = lastRhythmCountSeen;
  // SOLO usar flags del latido actual, desactivar rhythm.isAlert para permitir alternancia
  if (beatFlagsSuggestArrhythmia(flags)) {
    nextSeen = Math.max(nextSeen, rhythm.count);
    return { arrhythmic: true, lastRhythmCountSeen: nextSeen };
  }
  // Desactivado temporalmente: rhythmEscalation basado en rhythm.isAlert
  // const countJump = rhythm.count > lastRhythmCountSeen;
  // const rrIrreg = isLastRROutlier(rrIntervals);
  // const rhythmEscalation = rhythm.isAlert && (countJump || rrIrreg);
  // if (rhythmEscalation) {
  //   nextSeen = Math.max(nextSeen, rhythm.count);
  //   return { arrhythmic: true, lastRhythmCountSeen: nextSeen };
  // }
  return { arrhythmic: false, lastRhythmCountSeen: nextSeen };
}

/**
 * Prioridad: arritmia (flags/ritmo/RR) → ámbar (isWeak sin prematuro, o morfología baja) → normal.
 */
export function classifyBeatWaveClass(
  flags: BeatFlags | null,
  rhythm: RhythmPanel,
  rrIntervals: number[],
  lastRhythmCountSeen: number,
  morphologyScore?: number | null
): { waveClass: BeatWaveClass; lastRhythmCountSeen: number } {
  // SOLO usar flags del latido actual para clasificación - sin rhythm.isAlert
  if (beatFlagsSuggestArrhythmia(flags)) {
    return { waveClass: 'arrhythmia', lastRhythmCountSeen: Math.max(lastRhythmCountSeen, rhythm.count) };
  }
  const weakByFlag = !!(flags?.isWeak && !flags?.isPremature);
  const morph =
    morphologyScore != null &&
    Number.isFinite(morphologyScore) &&
    morphologyScore >= 0 &&
    morphologyScore < MORPHOLOGY_WEAK_BELOW;
  if (weakByFlag || morph) {
    return { waveClass: 'weak', lastRhythmCountSeen };
  }
  return { waveClass: 'normal', lastRhythmCountSeen };
}
