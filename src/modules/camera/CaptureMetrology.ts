/**
 * Etapa A — Metrología de captura: timestamps de presentación (requestVideoFrameCallback),
 * Fs efectivo robusto (mediana de Δt), jitter MAD, caídas y confianza [0,1].
 * Mejoras: Kalman filter para estimación suave, predictive timing, adaptive window.
 * Sin aleatoriedad: solo estadísticas sobre Δt observados.
 */

export interface CaptureTimingContext {
  /** Fs efectivo = 1000 / medianDeltaMs, acotado [15, 60] Hz. `0` = aún sin muestras Δt válidas (no inventar Hz). */
  sampleRateHz: number;
  /** Fs estimado por Kalman filter (más suave, menos sensible a outliers) */
  kalmanSampleRateHz: number;
  /** `0` si no hay mediana fiable aún */
  medianaDeltaMs: number;
  /** Mediana de |Δt − mediana| (robusta a outliers) */
  jitterMadMs: number;
  /** Desviación estándar de Δt (alternativa a MAD) */
  jitterStdMs: number;
  /** Drift acumulado de sample rate (cambio en Hz por segundo) */
  sampleRateDriftHzPerSec: number;
  /** Skew de distribución de Δt (asimetría) */
  deltaSkew: number;
  /** Contador acumulativo de intervalos anómalamente largos (vs mediana dinámica) */
  frameDropCount: number;
  /** Confianza heurística en la estimación actual [0, 1] */
  timingConfidence: number;
  /** Muestras válidas de Δt en la ventana */
  intervalCount: number;
  /** Tamaño actual de ventana adaptativo */
  windowSize: number;
  /** Predicción de próximo timestamp (para scheduling predictivo) */
  predictedNextTimestamp: number;
}

const clampSr = (hz: number): number => Math.max(15, Math.min(60, hz));

/** Kalman filter simple para estimación suave de sample rate */
class KalmanFilter {
  private estimate: number = 30;
  private error: number = 10;
  private readonly processNoise: number = 0.1;
  private readonly measurementNoise: number = 2;

  update(measurement: number): number {
    // Predict
    this.error = this.error + this.processNoise;

    // Update
    const kalmanGain = this.error / (this.error + this.measurementNoise);
    this.estimate = this.estimate + kalmanGain * (measurement - this.estimate);
    this.error = (1 - kalmanGain) * this.error;

    return this.estimate;
  }

  getEstimate(): number {
    return this.estimate;
  }

  reset(): void {
    this.estimate = 30;
    this.error = 10;
  }
}

export class CaptureMetrology {
  private readonly presentationTs: number[] = [];
  private maxSamples = 64;
  private minSamples = 16;
  /** Últimos Δt para umbral de drop vs mediana local (sin incluir el Δt actual) */
  private readonly recentDt: number[] = [];
  private readonly recentDtMax = 12;
  private dropCount = 0;
  private readonly kalmanFilter = new KalmanFilter();
  private lastSampleRate = 0;
  private lastTimestamp = 0;
  private driftAccumulator = 0;
  private driftSamples = 0;

  /** Reinicio al iniciar/detener medición */
  reset(): void {
    this.presentationTs.length = 0;
    this.recentDt.length = 0;
    this.dropCount = 0;
    this.kalmanFilter.reset();
    this.lastSampleRate = 0;
    this.lastTimestamp = 0;
    this.driftAccumulator = 0;
    this.driftSamples = 0;
    this.maxSamples = 64;
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
        sampleRateHz: 0,
        kalmanSampleRateHz: 0,
        medianaDeltaMs: 0,
        jitterMadMs: 0,
        jitterStdMs: 0,
        sampleRateDriftHzPerSec: 0,
        deltaSkew: 0,
        frameDropCount: this.dropCount,
        timingConfidence: 0,
        intervalCount: 0,
        windowSize: this.maxSamples,
        predictedNextTimestamp: 0,
      };
    }

    const deltas: number[] = [];
    for (let i = 1; i < ts.length; i++) {
      const dt = ts[i]! - ts[i - 1]!;
      if (dt >= 4 && dt <= 120) deltas.push(dt);
    }

    if (deltas.length < 3) {
      return {
        sampleRateHz: 0,
        kalmanSampleRateHz: 0,
        medianaDeltaMs: 0,
        jitterMadMs: 0,
        jitterStdMs: 0,
        sampleRateDriftHzPerSec: 0,
        deltaSkew: 0,
        frameDropCount: this.dropCount,
        timingConfidence: deltas.length > 0 ? 0.12 : 0,
        intervalCount: deltas.length,
        windowSize: this.maxSamples,
        predictedNextTimestamp: ts[ts.length - 1] ?? 0,
      };
    }

    const sorted = deltas.slice().sort((a, b) => a - b);
    const med = sorted[Math.floor(sorted.length / 2)] ?? 33.33;
    const devs = deltas.map((d) => Math.abs(d - med)).sort((a, b) => a - b);
    const mad = devs[Math.floor(devs.length / 2)] ?? 0;

    // Desviación estándar
    const mean = deltas.reduce((a, b) => a + b, 0) / deltas.length;
    const variance = deltas.reduce((sum, d) => sum + (d - mean) ** 2, 0) / deltas.length;
    const std = Math.sqrt(variance);

    // Skew (asimetría de distribución)
    const skew = deltas.length > 2 ?
      (deltas.reduce((sum, d) => sum + (d - mean) ** 3, 0) / deltas.length) / Math.pow(std, 3) : 0;

    const sr = clampSr(1000 / Math.max(8, med));

    // Kalman filter update
    const kalmanSr = this.kalmanFilter.update(sr);

    // Drift calculation
    let drift = 0;
    if (this.lastSampleRate > 0) {
      const deltaSr = kalmanSr - this.lastSampleRate;
      const timeDelta = (ts[ts.length - 1]! - this.lastTimestamp) / 1000;
      if (timeDelta > 0) {
        this.driftAccumulator += deltaSr / timeDelta;
        this.driftSamples++;
        drift = this.driftSamples > 0 ? this.driftAccumulator / this.driftSamples : 0;
      }
    }
    this.lastSampleRate = kalmanSr;
    this.lastTimestamp = ts[ts.length - 1]!;

    // Adaptive window size según estabilidad
    if (mad < 4 && deltas.length >= 20) {
      this.maxSamples = Math.max(this.minSamples, this.maxSamples - 2);
    } else if (mad > 10) {
      this.maxSamples = Math.min(128, this.maxSamples + 4);
    }

    let confidence = 0;
    if (deltas.length >= 8) confidence += 0.2;
    if (deltas.length >= 20) confidence += 0.2;
    if (deltas.length >= 40) confidence += 0.15;
    if (mad < 8) confidence += 0.25;
    if (mad < 4) confidence += 0.1;
    if (std < 6) confidence += 0.05;
    if (med >= 14 && med <= 68) confidence += 0.1;
    confidence = Math.max(0, Math.min(1, confidence));

    // Predictive timing
    const predictedNext = ts[ts.length - 1]! + med;

    return {
      sampleRateHz: sr,
      kalmanSampleRateHz: kalmanSr,
      medianaDeltaMs: med,
      jitterMadMs: mad,
      jitterStdMs: std,
      sampleRateDriftHzPerSec: drift,
      deltaSkew: skew,
      frameDropCount: this.dropCount,
      timingConfidence: confidence,
      intervalCount: deltas.length,
      windowSize: this.maxSamples,
      predictedNextTimestamp: predictedNext,
    };
  }

  getDropCount(): number {
    return this.dropCount;
  }
}
