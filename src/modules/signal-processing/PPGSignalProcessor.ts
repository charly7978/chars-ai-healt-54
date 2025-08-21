export interface PPGProcessingResult {
  isFingerDetected: boolean;
  signalQuality: number;
  rawValue: number;
  metrics: {
    snr: number;
    isStable: boolean;
  };
}

export class PPGSignalProcessor {
  private readonly BUFFER_SIZE = 128;

  private signalHistory: number[] = [];

  constructor() {}

  // =============================
  // MÉTODO PRINCIPAL DE PROCESO
  // =============================
  public processFrame(frame: number[][]): PPGProcessingResult {
    const avg = this.calculateFrameAverage(frame);
    const { r, g, b } = avg;

    // --- FILTRO 1: Color de piel ---
    if (!this.isSkinLike(r, g, b)) {
      return {
        isFingerDetected: false,
        signalQuality: 0,
        rawValue: r,
        metrics: { snr: 0, isStable: false }
      };
    }

    // Guardamos señal
    this.signalHistory.push(r);
    if (this.signalHistory.length > this.BUFFER_SIZE) {
      this.signalHistory.shift();
    }

    // --- FILTRO extra: descartar "rojo plano constante" ---
    if (this.isFlatRed(this.signalHistory)) {
      return {
        isFingerDetected: false,
        signalQuality: 0,
        rawValue: r,
        metrics: { snr: 0, isStable: false }
      };
    }

    // --- FILTRO 2: Pulsatilidad real ---
    if (!this.isPulsatile(this.signalHistory)) {
      return {
        isFingerDetected: false,
        signalQuality: 0,
        rawValue: r,
        metrics: { snr: 0, isStable: false }
      };
    }

    // --- FILTRO 3: Calidad mínima SNR ---
    const snr = this.calculateSignalQuality(this.signalHistory);
    if (snr < 8) {
      return {
        isFingerDetected: false,
        signalQuality: Math.min(100, snr * 10),
        rawValue: r,
        metrics: { snr, isStable: false }
      };
    }

    // ✅ Si pasa todos los filtros → detección válida
    return {
      isFingerDetected: true,
      signalQuality: Math.min(100, snr * 12),
      rawValue: r,
      metrics: { snr, isStable: true }
    };
  }

  // =============================
  // FILTRO 1: Validación color piel
  // =============================
  private isSkinLike(r: number, g: number, b: number): boolean {
    const total = r + g + b + 1e-10;
    const redRatio = r / total;
    const greenRatio = g / total;
    const blueRatio = b / total;

    // Rango típico de piel humana
    return (
      redRatio >= 0.35 && redRatio <= 0.65 &&
      greenRatio >= 0.2 && greenRatio <= 0.45 &&
      blueRatio >= 0.05 && blueRatio <= 0.25
    );
  }

  // =============================
  // FILTRO EXTRA: detectar rojo plano constante
  // =============================
  private isFlatRed(signal: number[]): boolean {
    if (signal.length < 20) return false;

    const mean = signal.reduce((a, b) => a + b, 0) / signal.length;
    const variance = signal.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / signal.length;
    const stdDev = Math.sqrt(variance);

    // Si la variación es casi nula → es luz roja fija (no dedo vivo)
    return stdDev < 1.5; // umbral ajustable según cámara
  }

  // =============================
  // FILTRO 2: Validación de pulsatilidad
  // =============================
  private isPulsatile(signal: number[]): boolean {
    if (signal.length < 40) return false;

    const peaks = this.detectRealPeaks(signal);
    if (peaks.length < 2) return false;

    const intervals: number[] = [];
    for (let i = 1; i < peaks.length; i++) {
      intervals.push(peaks[i] - peaks[i - 1]);
    }
    if (intervals.length < 2) return false;

    const avgInterval = intervals.reduce((a, b) => a + b, 0) / intervals.length;
    const bpm = 60000 / avgInterval;

    // Solo válido si el BPM es humano
    return bpm >= 48 && bpm <= 180;
  }

  // =============================
  // DETECTOR DE PICOS
  // =============================
  private detectRealPeaks(signal: number[]): number[] {
    const peaks: number[] = [];
    for (let i = 1; i < signal.length - 1; i++) {
      if (signal[i] > signal[i - 1] && signal[i] > signal[i + 1]) {
        peaks.push(i);
      }
    }
    return peaks;
  }

  // =============================
  // FILTRO 3: SNR de la señal
  // =============================
  private calculateSignalQuality(signal: number[]): number {
    if (signal.length < 20) return 0;

    const mean = signal.reduce((a, b) => a + b, 0) / signal.length;
    const variance = signal.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / signal.length;
    const stdDev = Math.sqrt(variance);

    if (stdDev === 0) return 0;

    const normalized = signal.map(v => (v - mean) / stdDev);

    const peaks = this.detectRealPeaks(normalized);
    if (peaks.length < 2) return 0;

    const signalPower = peaks.length / normalized.length;
    const noisePower = 1 - signalPower;

    return noisePower <= 0 ? 0 : signalPower / noisePower;
  }

  // =============================
  // UTILIDAD: Promedio de frame
  // =============================
  private calculateFrameAverage(frame: number[][]): { r: number; g: number; b: number } {
    let r = 0, g = 0, b = 0;
    let count = 0;

    for (const row of frame) {
      for (let i = 0; i < row.length; i += 4) {
        r += row[i];
        g += row[i + 1];
        b += row[i + 2];
        count++;
      }
    }

    return {
      r: r / count,
      g: g / count,
      b: b / count
    };
  }
}
