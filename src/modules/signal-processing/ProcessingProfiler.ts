/**
 * Acumula tiempos por etapa del pipeline (ms) con EWMA.
 */

export type PipelineStage =
  | 'extraction'
  | 'roiScore'
  | 'fusion'
  | 'sqi'
  | 'contact'
  | 'total';

export class ProcessingProfiler {
  private ewma = new Map<PipelineStage, number>();

  reset(): void {
    this.ewma.clear();
  }

  mark(stage: PipelineStage, ms: number): void {
    if (!isFinite(ms) || ms < 0) return;
    const prev = this.ewma.get(stage) ?? ms;
    this.ewma.set(stage, prev * 0.82 + ms * 0.18);
  }

  snapshot(): Record<string, number> {
    const o: Record<string, number> = {};
    for (const [k, v] of this.ewma) o[k] = Math.round(v * 100) / 100;
    return o;
  }
}
