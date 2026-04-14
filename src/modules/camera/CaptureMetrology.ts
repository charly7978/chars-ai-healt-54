/**
 * Etapa A — Metrología de captura: timestamps de presentación (requestVideoFrameCallback),
 * Fs efectivo robusto (mediana de Δt), jitter MAD, caídas y confianza [0,1].
 * Sin aleatoriedad: solo estadísticas sobre Δt observados.
 */

export interface CaptureTimingContext {
  /** Fs efectivo = 1000 / medianDeltaMs, acotado [15, 60] Hz */
  sampleRateHz: number;
  medianaDeltaMs: number;
  /** Mediana de |Δt − mediana| (robusta a outliers) */
  jitterMadMs: number;
  /** Contador acumulativo de intervalos anómalamente largos (vs mediana dinámica) */
  frameDropCount: number;
  /** Confianza heurística en la estimación actual [0, 1] */
  timingConfidence: number;
  /** Muestras válidas de Δt en la ventana */
  intervalCount: number;
}

const clampSr = (hz: number): number => Math.max(15, Math.min(60, hz));

export class CaptureMetrology {
  private readonly presentationTs: number[] = [];
  private readonly maxSamples = 64;
  /** Últimos Δt para umbral de drop vs mediana local (sin incluir el Δt actual) */
  private readonly recentDt: number[] = [];
  private readonly recentDtMax = 12;
  private dropCount = 0;

  /** Reinicio al iniciar/detener medición */
  reset(): void {
    this.presentationTs.length = 0;
    this.recentDt.length = 0;
    this.dropCount = 0;
  }

  /**
   * Registrar instante de presentación del frame (mismo `now` que RVFC entrega al callback).
   * Debe ser monótono creciente en la práctica (DOMHighResTimeStamp).
   */
  recordPresentationTime(ts: number): void {
    if (!isFinite(ts)) return;
    const prev = this.presentationTs.length > 0 ? this.presentationTs[this.presentationTs.length - 1]! : 0;
    if (prev > 0 && ts < prev - 1) {
      return;
    }
    if (prev > 0) {
      const dt = ts - prev;
      if (dt >= 4 && dt <= 200) {
        if (this.recentDt.length >= 3) {
          const s = this.recentDt.slice().sort((a, b) => a - b);
          const med = s[Math.floor(s.length / 2)] ?? 33;
          if (dt > Math.max(med * 1.75, 48)) this.dropCount++;
        } else if (dt > 55) {
          this.dropCount++;
        }
        this.recentDt.push(dt);
        if (this.recentDt.length > this.recentDtMax) this.recentDt.shift();
      }
    }
    this.presentationTs.push(ts);
    if (this.presentationTs.length > this.maxSamples) {
      this.presentationTs.shift();
    }
  }

  getSnapshot(): CaptureTimingContext {
    const ts = this.presentationTs;
    if (ts.length < 2) {
      return {
        sampleRateHz: 30,
        medianaDeltaMs: 1000 / 30,
        jitterMadMs: 0,
        frameDropCount: this.dropCount,
        timingConfidence: 0,
        intervalCount: 0,
      };
    }

    const deltas: number[] = [];
    for (let i = 1; i < ts.length; i++) {
      const dt = ts[i]! - ts[i - 1]!;
      if (dt >= 4 && dt <= 120) deltas.push(dt);
    }

    if (deltas.length < 3) {
      return {
        sampleRateHz: 30,
        medianaDeltaMs: 1000 / 30,
        jitterMadMs: 0,
        frameDropCount: this.dropCount,
        timingConfidence: 0.15,
        intervalCount: deltas.length,
      };
    }

    const sorted = deltas.slice().sort((a, b) => a - b);
    const med = sorted[Math.floor(sorted.length / 2)] ?? 33.33;
    const devs = deltas.map((d) => Math.abs(d - med)).sort((a, b) => a - b);
    const mad = devs[Math.floor(devs.length / 2)] ?? 0;

    const sr = clampSr(1000 / Math.max(8, med));

    let confidence = 0;
    if (deltas.length >= 8) confidence += 0.2;
    if (deltas.length >= 20) confidence += 0.2;
    if (deltas.length >= 40) confidence += 0.15;
    if (mad < 8) confidence += 0.25;
    if (mad < 4) confidence += 0.1;
    if (med >= 14 && med <= 68) confidence += 0.1;
    confidence = Math.max(0, Math.min(1, confidence));

    return {
      sampleRateHz: sr,
      medianaDeltaMs: med,
      jitterMadMs: mad,
      frameDropCount: this.dropCount,
      timingConfidence: confidence,
      intervalCount: deltas.length,
    };
  }

  getDropCount(): number {
    return this.dropCount;
  }
}
