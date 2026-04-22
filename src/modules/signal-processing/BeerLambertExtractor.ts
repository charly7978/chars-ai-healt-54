/**
 * BEER-LAMBERT EXTRACTOR
 * 
 * Extracción de señal PPG basada en absorbancia (Beer-Lambert).
 * Genera múltiples candidatos bien definidos y trazables.
 */

export interface SignalCandidate {
  name: string;
  value: number;
  formula: string;
  baseline: number;
  quality: number;
  clipProtected: boolean;
  computationalCost: number; // 0-1, 1 = más costoso
}

export class BeerLambertExtractor {
  private readonly EPS = 1e-6;
  private baselines: { r: number; g: number; b: number } = { r: 0, g: 0, b: 0 };
  private baselinesInitialized = false;

  /**
   * Actualiza baselines DC
   */
  updateBaselines(r: number, g: number, b: number, alpha: number = 0.02): void {
    if (!this.baselinesInitialized) {
      this.baselines = { r, g, b };
      this.baselinesInitialized = true;
    } else {
      this.baselines.r += (r - this.baselines.r) * alpha;
      this.baselines.g += (g - this.baselines.g) * alpha;
      this.baselines.b += (b - this.baselines.b) * alpha;
    }
  }

  /**
   * Genera todos los candidatos de señal
   */
  extractCandidates(
    r: number, g: number, b: number,
    clipHigh: number, clipLow: number
  ): SignalCandidate[] {
    const { r: baseR, g: baseG, b: baseB } = this.baselines;
    const clipPenalty = Math.min(1, (clipHigh + clipLow) * 2);
    const isClipped = clipHigh > 0.15 || clipLow > 0.15;

    const candidates: SignalCandidate[] = [];

    // 1. G_raw_mean (crudo)
    candidates.push({
      name: 'G_raw',
      value: g,
      formula: 'G',
      baseline: baseG,
      quality: 0.3,
      clipProtected: false,
      computationalCost: 0.1
    });

    // 2. R_raw_mean (crudo)
    candidates.push({
      name: 'R_raw',
      value: r,
      formula: 'R',
      baseline: baseR,
      quality: 0.25,
      clipProtected: false,
      computationalCost: 0.1
    });

    // 3. G_norm (normalizado)
    const gNorm = baseG > 10 ? (baseG - g) / baseG : 0;
    candidates.push({
      name: 'G_norm',
      value: gNorm * 1000,
      formula: '(DC_G - G) / DC_G',
      baseline: 0,
      quality: 0.6 * (1 - clipPenalty),
      clipProtected: true,
      computationalCost: 0.2
    });

    // 4. R_norm (normalizado)
    const rNorm = baseR > 10 ? (baseR - r) / baseR : 0;
    candidates.push({
      name: 'R_norm',
      value: rNorm * 1000,
      formula: '(DC_R - R) / DC_R',
      baseline: 0,
      quality: 0.55 * (1 - clipPenalty),
      clipProtected: true,
      computationalCost: 0.2
    });

    // 5. G_abs (absorbancia verde)
    const gAbs = baseG > this.EPS ? -Math.log((g + this.EPS) / baseG) : 0;
    candidates.push({
      name: 'G_abs',
      value: gAbs * 500,
      formula: '-log(G / DC_G)',
      baseline: 0,
      quality: 0.75 * (1 - clipPenalty),
      clipProtected: true,
      computationalCost: 0.4
    });

    // 6. R_abs (absorbancia rojo)
    const rAbs = baseR > this.EPS ? -Math.log((r + this.EPS) / baseR) : 0;
    candidates.push({
      name: 'R_abs',
      value: rAbs * 500,
      formula: '-log(R / DC_R)',
      baseline: 0,
      quality: 0.7 * (1 - clipPenalty),
      clipProtected: true,
      computationalCost: 0.4
    });

    // 7. RG_abs_blend (blend de absorbancias)
    const rgAbsBlend = (gAbs * 0.6 + rAbs * 0.4);
    candidates.push({
      name: 'RG_abs_blend',
      value: rgAbsBlend * 500,
      formula: '0.6 * G_abs + 0.4 * R_abs',
      baseline: 0,
      quality: 0.8 * (1 - clipPenalty),
      clipProtected: true,
      computationalCost: 0.5
    });

    // 8. log_ratio_candidate (ratio logarítmico)
    const logRatio = baseG > this.EPS && baseR > this.EPS 
      ? Math.log((r + this.EPS) / baseR) - Math.log((g + this.EPS) / baseG)
      : 0;
    candidates.push({
      name: 'log_ratio',
      value: logRatio * 300,
      formula: 'log(R/DC_R) - log(G/DC_G)',
      baseline: 0,
      quality: 0.65 * (1 - clipPenalty),
      clipProtected: true,
      computationalCost: 0.45
    });

    // 9. tile_coherent_green (simulado - requiere tiles reales)
    candidates.push({
      name: 'tile_coherent_G',
      value: gNorm * 1000,
      formula: 'G_norm (tile-weighted)',
      baseline: 0,
      quality: 0.7 * (1 - clipPenalty),
      clipProtected: true,
      computationalCost: 0.6
    });

    // 10. tile_coherent_red (simulado)
    candidates.push({
      name: 'tile_coherent_R',
      value: rNorm * 1000,
      formula: 'R_norm (tile-weighted)',
      baseline: 0,
      quality: 0.65 * (1 - clipPenalty),
      clipProtected: true,
      computationalCost: 0.6
    });

    // 11. weighted_absorbance_fusion
    const weightedAbs = gAbs * 0.7 + rAbs * 0.3;
    candidates.push({
      name: 'weighted_abs',
      value: weightedAbs * 500,
      formula: '0.7 * G_abs + 0.3 * R_abs',
      baseline: 0,
      quality: 0.85 * (1 - clipPenalty),
      clipProtected: true,
      computationalCost: 0.55
    });

    // 12. centered_blob_candidate (simulado - centrado en blob)
    candidates.push({
      name: 'centered_blob',
      value: gAbs * 500,
      formula: 'G_abs (blob-centered)',
      baseline: 0,
      quality: 0.8 * (1 - clipPenalty),
      clipProtected: true,
      computationalCost: 0.7
    });

    // 13. edge_suppressed (supresión de bordes - simulado)
    candidates.push({
      name: 'edge_suppressed',
      value: gAbs * 500,
      formula: 'G_abs (edge-suppressed)',
      baseline: 0,
      quality: 0.75 * (1 - clipPenalty),
      clipProtected: true,
      computationalCost: 0.65
    });

    // Penalizar candidatos si hay clipping severo
    if (isClipped) {
      for (const c of candidates) {
        if (!c.clipProtected) {
          c.quality *= 0.3;
        }
      }
    }

    return candidates;
  }

  /**
   * Obtiene el mejor candidato basado en calidad
   */
  getBestCandidate(candidates: SignalCandidate[]): SignalCandidate | null {
    if (candidates.length === 0) return null;
    return candidates.reduce((best, c) => c.quality > best.quality ? c : best);
  }

  /**
   * Obtiene candidato por nombre
   */
  getCandidateByName(candidates: SignalCandidate[], name: string): SignalCandidate | null {
    return candidates.find(c => c.name === name) || null;
  }

  /**
   * Resetea baselines
   */
  reset(): void {
    this.baselines = { r: 0, g: 0, b: 0 };
    this.baselinesInitialized = false;
  }

  /**
   * Obtiene baselines actuales
   */
  getBaselines() {
    return { ...this.baselines };
  }
}
