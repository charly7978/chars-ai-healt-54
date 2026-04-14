/**
 * ROI adaptativa — delegación al mismo núcleo que FrameAnalysisCore para evitar duplicar
 * lógica de tiles/assembler. Mantiene ROIMaskResult para compatibilidad.
 */

import { FrameAnalysisEngine, type ROIMaskResult } from './FrameAnalysisCore';
import type { TileSnapshot } from './TilePulsatilityMap';

/** Alias de compatibilidad — métricas detalladas en TileSnapshot */
export type TileMetrics = TileSnapshot;

export type { ROIMaskResult };

export class AdaptiveROIMask {
  private readonly engine = new FrameAnalysisEngine();

  process(imageData: ImageData): ROIMaskResult {
    const r = this.engine.processFrame(imageData, performance.now(), false);
    return {
      ...r.roi,
      debugBbox: r.roiBBox,
    };
  }

  reset(): void {
    this.engine.reset();
  }
}
