/**
 * Puntuación compuesta por ROI, ranking top-K, pesos suavizados con inercia temporal.
 */

import { MultiROIExtractor } from './MultiROIExtractor';
import type { ROICellMetrics } from './MultiROIExtractor';
const TOP_K = 6;

export class ROIScorer {
  private prevScores: Float64Array = new Float64Array(0);
  private readonly alpha = 0.35;

  reset(): void {
    this.prevScores = new Float64Array(0);
  }

  /**
   * Devuelve scores por celda, pesos normalizados top-K, filas de debug.
   */
  scoreFrame(
    cells: ROICellMetrics[],
    motionLocal: number,
    spectralConcentration: number,
    pulseTemplateCorr: number
  ): {
    scores: Float64Array;
    weights: Float64Array;
    topIndices: number[];
    rows: ROIQualityRow[];
    rejectReasons: (string | undefined)[];
  } {
    const n = cells.length;
    if (this.prevScores.length !== n) {
      this.prevScores = new Float64Array(n);
    }

    const scores = new Float64Array(n);
    const reasons: (string | undefined)[] = new Array(n);

    for (let i = 0; i < n; i++) {
      const c = cells[i];
      let r: string | undefined;

      if (c.validFraction < 0.25) {
        scores[i] = 0;
        r = 'pocos píxeles válidos';
      } else if (c.clipRatio > 0.45) {
        scores[i] = 0.05;
        r = 'clipping alto';
      } else if (c.meanR < 35 && c.meanG < 35) {
        scores[i] = 0.08;
        r = 'señal oscura';
      } else {
        const chroma = Math.min(1, (c.meanR / Math.max(8, c.meanG) - 1) / 0.55) * 0.28;
        const ac = Math.min(1, c.acdcProxy / 0.06) * 0.26;
        const clipPen = Math.min(0.55, c.clipRatio * 1.1) * 0.22;
        const stab = Math.min(1, c.validFraction) * 0.12;
        const spec = spectralConcentration * 0.08;
        const tpl = Math.max(0, pulseTemplateCorr) * 0.08;
        const mot = Math.min(0.35, motionLocal) * 0.18;
        const raw = chroma + ac + stab + spec + tpl - clipPen - mot;
        scores[i] = Math.max(0, Math.min(1, raw));
      }
      reasons[i] = r;

      const sm = this.prevScores[i] * (1 - this.alpha) + scores[i] * this.alpha;
      this.prevScores[i] = sm;
      scores[i] = sm;
    }

    const order = Array.from({ length: n }, (_, i) => i);
    order.sort((a, b) => scores[b] - scores[a]);

    const topIndices = order.slice(0, TOP_K).filter((idx) => scores[idx] > 0.04);
    const weights = new Float64Array(n);
    let sum = 0;
    for (const idx of topIndices) {
      const w = scores[idx] * scores[idx];
      weights[idx] = w;
      sum += w;
    }
    if (sum > 1e-9) {
      for (let i = 0; i < n; i++) weights[i] /= sum;
    }

    const rows = MultiROIExtractor.rowsToQualityRows(cells, scores, reasons);

    return { scores, weights, topIndices, rows, rejectReasons: reasons };
  }
}
