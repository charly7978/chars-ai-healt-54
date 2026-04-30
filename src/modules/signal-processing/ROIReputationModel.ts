/**
 * Reputación temporal por ROI + persistencia espacial + conteo de switches.
 */

import type { ROICellMetrics } from './MultiROIExtractor';
import { EWMA_DECAY_SLOW, EWMA_DECAY_MEDIUM } from '@/constants/processing';

export interface ROIReputationDebug {
  reputation: Float64Array;
  topId: number;
  persistentTopId: number;
  clusterWinnerId: number;
  refinementStage: 'coarse' | 'fine';
  switchesPerMinute: number;
}

export class ROIReputationModel {
  private n: number;
  private rep = new Float64Array(0);
  private clipEwma = new Float64Array(0);
  private flipEwma = new Float64Array(0);
  private lastTop = -1;
  private persistentTop = -1;
  private persistCount = 0;
  private switchTimestamps: number[] = [];
  private frameCounter = 0;

  constructor(cellCount: number) {
    this.n = cellCount;
    this.alloc();
  }

  private alloc(): void {
    this.rep = new Float64Array(this.n);
    this.clipEwma = new Float64Array(this.n);
    this.flipEwma = new Float64Array(this.n);
  }

  reset(): void {
    this.rep.fill(0);
    this.clipEwma.fill(0);
    this.flipEwma.fill(0);
    this.lastTop = -1;
    this.persistentTop = -1;
    this.persistCount = 0;
    this.switchTimestamps = [];
    this.frameCounter = 0;
  }

  ensureSize(cellCount: number): void {
    if (cellCount === this.n) return;
    this.n = cellCount;
    this.alloc();
  }

  /**
   * @param scores score bruto por celda (post-suavizado scorer)
   * @param spectral01 calidad espectral global [0..1]
   */
  update(cells: ROICellMetrics[], scores: Float64Array, spectral01: number, nowMs: number): Float64Array {
    this.ensureSize(cells.length);
    this.frameCounter++;

    let best = -1;
    let bestS = -1;
    for (let i = 0; i < cells.length; i++) {
      const c = cells[i];
      const clip = c.clipRatio;
      this.clipEwma[i] = this.clipEwma[i] * EWMA_DECAY_SLOW + clip * (1 - EWMA_DECAY_SLOW);

      const flip = Math.abs(scores[i] - (this.rep[i] > 0 ? this.rep[i] : scores[i]));
      this.flipEwma[i] = this.flipEwma[i] * EWMA_DECAY_MEDIUM + flip * (1 - EWMA_DECAY_MEDIUM);

      const stability = Math.max(0, 1 - this.flipEwma[i] * 4);
      const clipPen = Math.min(0.6, this.clipEwma[i] * 1.4);
      const base = scores[i] * (0.42 + 0.58 * spectral01);
      const next = this.rep[i] * 0.82 + (base * stability + c.validFraction * 0.06 - clipPen * 0.12) * 0.18;
      this.rep[i] = Math.max(0, Math.min(1.2, next));

      if (scores[i] > bestS) {
        bestS = scores[i];
        best = i;
      }
    }

    if (best >= 0) {
      if (this.lastTop >= 0 && best !== this.lastTop) {
        this.switchTimestamps.push(nowMs);
        const cutoff = nowMs - 60000;
        this.switchTimestamps = this.switchTimestamps.filter((t) => t >= cutoff);
      }
      this.lastTop = best;
      if (this.persistentTop < 0 || best === this.persistentTop) {
        this.persistentTop = best;
        this.persistCount = Math.min(200, this.persistCount + 1);
      } else if (bestS > 0.18 && this.persistCount > 8) {
        this.persistCount--;
        if (this.persistCount <= 0) {
          this.persistentTop = best;
          this.persistCount = 12;
        }
      } else {
        this.persistCount = Math.max(0, this.persistCount - 1);
      }
    }

    const mult = new Float64Array(this.n);
    for (let i = 0; i < this.n; i++) {
      let m = 0.55 + 0.45 * Math.min(1, this.rep[i]);
      if (this.persistentTop >= 0) {
        const dr = Math.abs(cells[i].row - cells[this.persistentTop].row);
        const dc = Math.abs(cells[i].col - cells[this.persistentTop].col);
        const neigh = dr + dc;
        if (neigh <= 1) m *= 1.06;
        else if (neigh >= 4) m *= 0.94;
      }
      if (this.rep[i] < 0.12 && scores[i] < 0.08) m *= 0.35;
      mult[i] = m;
    }
    return mult;
  }

  clusterWinner(cells: ROICellMetrics[], scores: Float64Array): number {
    let best = 0;
    let bestSum = -1;
    for (let i = 0; i < cells.length; i++) {
      let s = scores[i] * (0.5 + 0.5 * this.rep[i]);
      for (let j = 0; j < cells.length; j++) {
        if (i === j) continue;
        const dr = Math.abs(cells[i].row - cells[j].row);
        const dc = Math.abs(cells[i].col - cells[j].col);
        if (dr <= 1 && dc <= 1 && scores[j] > 0.1) s += scores[j] * 0.18;
      }
      if (s > bestSum) {
        bestSum = s;
        best = i;
      }
    }
    return best;
  }

  getDebug(cells: ROICellMetrics[], scores: Float64Array, stage: 'coarse' | 'fine'): ROIReputationDebug {
    const cw = this.clusterWinner(cells, scores);
    const now = typeof performance !== 'undefined' ? performance.now() : 0;
    const cutoff = now - 60000;
    const switches = this.switchTimestamps.filter((t) => t >= cutoff).length;
    return {
      reputation: Float64Array.from(this.rep),
      topId: this.lastTop,
      persistentTopId: this.persistentTop,
      clusterWinnerId: cw,
      refinementStage: stage,
      switchesPerMinute: switches,
    };
  }
}
