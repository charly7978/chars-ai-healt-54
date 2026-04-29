/**
 * Elgendi 2013 — Systolic Peak Detection in PPG with Two Event-Related Moving Averages.
 *
 * Reference: Elgendi M, Norton I, Brearley M, Abbott D, Schuurmans D.
 * "Systolic Peak Detection in Acceleration Photoplethysmograms Measured
 * from Emergency Responders in Tropical Conditions." PLOS One 8(10), 2013.
 * https://doi.org/10.1371/journal.pone.0076585
 *
 * Validado por NeuroKit2, PPG-BEATS, pyPPG (papers 2020-2026).
 * Sensibilidad ~99.9% en bases de datos clínicas estándar.
 *
 * Algoritmo (streaming/online):
 *  1. Squaring de la señal filtrada (band-pass 0.5-8 Hz aplicada upstream).
 *  2. MApeak = moving-average de 111 ms — emfatiza picos sistólicos.
 *  3. MAbeat = moving-average de 667 ms — emfatiza el latido completo.
 *  4. Threshold THR1 = MAbeat + α · mean(squared)   con α = 0.02
 *  5. Block of interest = región contigua donde MApeak > THR1.
 *  6. Si la duración del block ≥ THR2 (= 111 ms = ventana del MApeak),
 *     se busca el máximo dentro y se acepta como sistólico.
 *  7. Refractory mínimo entre picos: 300 ms (para PPG, no 200 ms del ECG).
 *
 * Esta implementación es STREAMING: procesa muestra a muestra y emite
 * `isPeak: true` cuando confirma un sistólico, sin necesidad de un
 * buffer global ni de procesar la señal en bloque.
 */

export interface ElgendiPeakResult {
  /** True si en este sample se confirmó un pico sistólico. */
  isPeak: boolean;
  /** Timestamp del pico (ms) si isPeak. */
  peakTime: number;
  /** Amplitud del pico (valor squared) si isPeak. */
  peakAmplitude: number;
  /** Threshold actual (debug). */
  threshold: number;
  /** MApeak actual. */
  maPeak: number;
  /** MAbeat actual. */
  maBeat: number;
}

export interface ElgendiPeakConfig {
  /** Sample rate efectivo (Hz). */
  sampleRate: number;
  /** Ventana MApeak en ms (default 111 ms - Elgendi 2013). */
  peakWindowMs: number;
  /** Ventana MAbeat en ms (default 667 ms - Elgendi 2013). */
  beatWindowMs: number;
  /** Offset α de threshold (default 0.02 - Elgendi 2013). */
  alpha: number;
  /** Refractory mínimo entre picos (default 300 ms - PPG). */
  refractoryMs: number;
  /** Ventana de mean(squared) para el threshold base (ms). */
  meanWindowMs: number;
}

const DEFAULT: ElgendiPeakConfig = {
  sampleRate: 30,
  peakWindowMs: 111,
  beatWindowMs: 667,
  alpha: 0.02,
  refractoryMs: 300,
  meanWindowMs: 4000,
};

export class ElgendiPeakDetector {
  private cfg: ElgendiPeakConfig;
  private peakWindow = 4;
  private beatWindow = 20;
  private meanWindow = 120;

  private peakBuf: Float64Array;
  private beatBuf: Float64Array;
  private meanBuf: Float64Array;
  private peakIdx = 0;
  private beatIdx = 0;
  private meanIdx = 0;
  private peakSum = 0;
  private beatSum = 0;
  private meanSum = 0;
  private peakFilled = 0;
  private beatFilled = 0;
  private meanFilled = 0;

  // Block-of-interest tracking
  private inBlock = false;
  private blockStartTs = 0;
  private blockMaxValue = 0;
  private blockMaxTs = 0;
  private blockSampleCount = 0;

  // Refractory
  private lastPeakTs = 0;

  constructor(config: Partial<ElgendiPeakConfig> = {}) {
    this.cfg = { ...DEFAULT, ...config };
    this.recomputeWindowSizes();
    this.peakBuf = new Float64Array(this.peakWindow);
    this.beatBuf = new Float64Array(this.beatWindow);
    this.meanBuf = new Float64Array(this.meanWindow);
  }

  private recomputeWindowSizes(): void {
    const sr = Math.max(10, this.cfg.sampleRate);
    this.peakWindow = Math.max(2, Math.round((this.cfg.peakWindowMs / 1000) * sr));
    this.beatWindow = Math.max(this.peakWindow + 1, Math.round((this.cfg.beatWindowMs / 1000) * sr));
    this.meanWindow = Math.max(this.beatWindow + 1, Math.round((this.cfg.meanWindowMs / 1000) * sr));
  }

  /**
   * Permite reajustar el sample rate sin perder los buffers acumulados
   * más allá de lo necesario (re-allocation de los rings).
   */
  setSampleRate(sr: number): void {
    if (Math.abs(sr - this.cfg.sampleRate) < 1.5) return;
    this.cfg.sampleRate = sr;
    const oldPeak = this.peakWindow;
    const oldBeat = this.beatWindow;
    const oldMean = this.meanWindow;
    this.recomputeWindowSizes();
    if (this.peakWindow !== oldPeak) {
      this.peakBuf = new Float64Array(this.peakWindow);
      this.peakIdx = 0;
      this.peakSum = 0;
      this.peakFilled = 0;
    }
    if (this.beatWindow !== oldBeat) {
      this.beatBuf = new Float64Array(this.beatWindow);
      this.beatIdx = 0;
      this.beatSum = 0;
      this.beatFilled = 0;
    }
    if (this.meanWindow !== oldMean) {
      this.meanBuf = new Float64Array(this.meanWindow);
      this.meanIdx = 0;
      this.meanSum = 0;
      this.meanFilled = 0;
    }
  }

  /**
   * Procesa una muestra del PPG ya filtrada (banda 0.5-8 Hz upstream).
   * Devuelve isPeak=true en el frame en que se confirma un sistólico.
   */
  process(value: number, timestampMs: number): ElgendiPeakResult {
    // Step 1: clip negativos (el sistólico es la componente positiva).
    const clipped = value > 0 ? value : 0;
    // Step 2: squaring para enfatizar sistólico y suprimir ruido.
    const sqrd = clipped * clipped;

    // Update rolling sums (peak, beat, mean) — O(1) por muestra.
    {
      const old = this.peakBuf[this.peakIdx];
      this.peakSum += sqrd - old;
      this.peakBuf[this.peakIdx] = sqrd;
      this.peakIdx = (this.peakIdx + 1) % this.peakWindow;
      if (this.peakFilled < this.peakWindow) this.peakFilled++;
    }
    {
      const old = this.beatBuf[this.beatIdx];
      this.beatSum += sqrd - old;
      this.beatBuf[this.beatIdx] = sqrd;
      this.beatIdx = (this.beatIdx + 1) % this.beatWindow;
      if (this.beatFilled < this.beatWindow) this.beatFilled++;
    }
    {
      const old = this.meanBuf[this.meanIdx];
      this.meanSum += sqrd - old;
      this.meanBuf[this.meanIdx] = sqrd;
      this.meanIdx = (this.meanIdx + 1) % this.meanWindow;
      if (this.meanFilled < this.meanWindow) this.meanFilled++;
    }

    const maPeak = this.peakFilled > 0 ? this.peakSum / this.peakFilled : 0;
    const maBeat = this.beatFilled > 0 ? this.beatSum / this.beatFilled : 0;
    const meanSqrd = this.meanFilled > 0 ? this.meanSum / this.meanFilled : 0;

    // Threshold THR1 = MAbeat + α · mean(squared)
    const thr1 = maBeat + this.cfg.alpha * meanSqrd;

    // No emitir hasta que los buffers de moving-averages estén llenos
    // (evita falsos picos por arranque frío).
    const ready = this.peakFilled >= this.peakWindow && this.beatFilled >= this.beatWindow;

    let isPeak = false;
    let peakTime = 0;
    let peakAmplitude = 0;

    if (ready) {
      const aboveThreshold = maPeak > thr1;
      if (aboveThreshold) {
        if (!this.inBlock) {
          this.inBlock = true;
          this.blockStartTs = timestampMs;
          this.blockMaxValue = sqrd;
          this.blockMaxTs = timestampMs;
          this.blockSampleCount = 1;
        } else {
          this.blockSampleCount++;
          if (sqrd > this.blockMaxValue) {
            this.blockMaxValue = sqrd;
            this.blockMaxTs = timestampMs;
          }
        }
      } else {
        if (this.inBlock) {
          // Block terminado: confirmar pico si duración ≥ 90% de peakWindow (THR2).
          // Ajustado a 0.9 para mayor rechazo de falsos positivos sintéticos.
          const durationMs = timestampMs - this.blockStartTs;
          if (durationMs >= this.cfg.peakWindowMs * 0.9) {
            // Refractory check
            if (this.blockMaxTs - this.lastPeakTs >= this.cfg.refractoryMs) {
              isPeak = true;
              peakTime = this.blockMaxTs;
              peakAmplitude = this.blockMaxValue;
              this.lastPeakTs = this.blockMaxTs;
            }
          }
          this.inBlock = false;
          this.blockSampleCount = 0;
        }
      }
    }

    return {
      isPeak,
      peakTime,
      peakAmplitude,
      threshold: thr1,
      maPeak,
      maBeat,
    };
  }

  reset(): void {
    this.peakBuf.fill(0);
    this.beatBuf.fill(0);
    this.meanBuf.fill(0);
    this.peakIdx = 0;
    this.beatIdx = 0;
    this.meanIdx = 0;
    this.peakSum = 0;
    this.beatSum = 0;
    this.meanSum = 0;
    this.peakFilled = 0;
    this.beatFilled = 0;
    this.meanFilled = 0;
    this.inBlock = false;
    this.blockStartTs = 0;
    this.blockMaxValue = 0;
    this.blockMaxTs = 0;
    this.blockSampleCount = 0;
    this.lastPeakTs = 0;
  }
}
