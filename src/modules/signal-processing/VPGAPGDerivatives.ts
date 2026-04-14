/**
 * VPG/APG Derivatives para PPG.
 * Basado en literatura 2024 de velocity/acceleration photoplethysmography.
 * Calcula:
 * - VPG (Velocity PPG): Primera derivada de PPG
 * - APG (Acceleration PPG): Segunda derivada de PPG
 * - Características morfológicas para análisis cardiovascular
 */

export interface VPGAPGResult {
  ppg: number;              // PPG original
  vpg: number;              // Velocity PPG (1ra derivada)
  apg: number;              // Acceleration PPG (2da derivada)
  vpgSlope: number;         // Pendiente VPG
  apgPeaks: number[];       // Peaks en APG
  systolicUpstroke: number; // Pendiente de upstroke sistólico
  dicroticNotch: number;   // Profundidad del dicrotic notch
}

export interface VPGAPGConfig {
  derivativeWindow: number;   // Ventana para derivadas
  smoothingFactor: number;   // Factor de suavizado
  peakDetectionThreshold: number; // Threshold para detección de peaks
}

export class VPGAPGDerivatives {
  private readonly config: VPGAPGConfig;
  private readonly ppgBuffer: Float32Array;
  private readonly vpgBuffer: Float32Array;
  private bufferIndex = 0;
  private readonly bufferSize = 64;

  constructor(config?: Partial<VPGAPGConfig>) {
    this.config = {
      derivativeWindow: 3,
      smoothingFactor: 0.2,
      peakDetectionThreshold: 0.3,
      ...config,
    };
    this.ppgBuffer = new Float32Array(this.bufferSize);
    this.vpgBuffer = new Float32Array(this.bufferSize);
  }

  /**
   * Calcula VPG/APG derivadas de señal PPG
   * @param ppgValue: Valor actual de señal PPG
   * @returns Resultado con VPG/APG y características
   */
  compute(ppgValue: number): VPGAPGResult {
    // Almacenar en buffer
    this.ppgBuffer[this.bufferIndex] = ppgValue;
    this.bufferIndex = (this.bufferIndex + 1) % this.bufferSize;

    // Necesitamos suficientes muestras
    if (this.bufferIndex < 5) {
      return {
        ppg: ppgValue,
        vpg: 0,
        apg: 0,
        vpgSlope: 0,
        apgPeaks: [],
        systolicUpstroke: 0,
        dicroticNotch: 0,
      };
    }

    // Calcular VPG (primera derivada)
    const vpg = this.computeVPG();
    
    // Almacenar VPG en buffer
    this.vpgBuffer[this.bufferIndex - 1] = vpg;
    
    // Calcular APG (segunda derivada)
    const apg = this.computeAPG();
    
    // Calcular características
    const vpgSlope = this.computeVPGSlope(vpg);
    const apgPeaks = this.detectAPGPeaks(apg);
    const systolicUpstroke = this.computeSystolicUpstroke();
    const dicroticNotch = this.computeDicroticNotch();

    return {
      ppg: ppgValue,
      vpg,
      apg,
      vpgSlope,
      apgPeaks,
      systolicUpstroke,
      dicroticNotch,
    };
  }

  /**
   * Calcula VPG (primera derivada)
   */
  private computeVPG(): number {
    const win = this.config.derivativeWindow;
    const idx = this.bufferIndex - 1;
    
    if (idx < win) return 0;
    
    // Derivada central: (f(x+h) - f(x-h)) / (2h)
    const prev = this.ppgBuffer[idx - win]!;
    const next = this.ppgBuffer[idx]!;
    const derivative = (next - prev) / (2 * win);
    
    // Suavizado EWMA
    const smoothed = this.smoothVPG(derivative);
    
    return smoothed;
  }

  /**
   * Calcula APG (segunda derivada)
   */
  private computeAPG(): number {
    const win = this.config.derivativeWindow;
    const idx = this.bufferIndex - 1;
    
    if (idx < win * 2) return 0;
    
    // Segunda derivada: (f(x+h) - 2f(x) + f(x-h)) / h^2
    const prev = this.ppgBuffer[idx - win]!;
    const curr = this.ppgBuffer[idx]!;
    const next = this.ppgBuffer[idx + win]!;
    const secondDerivative = (next - 2 * curr + prev) / (win * win);
    
    return secondDerivative;
  }

  /**
   * Suaviza VPG con EWMA
   */
  private smoothVPG(vpg: number): number {
    const alpha = this.config.smoothingFactor;
    const prevVPG = this.vpgBuffer[this.bufferIndex - 2] ?? 0;
    
    return alpha * vpg + (1 - alpha) * prevVPG;
  }

  /**
   * Calcula pendiente de VPG
   */
  private computeVPGSlope(vpg: number): number {
    const idx = this.bufferIndex - 1;
    if (idx < 2) return 0;
    
    const prevVPG = this.vpgBuffer[idx - 1]!;
    return vpg - prevVPG;
  }

  /**
   * Detecta peaks en APG
   */
  private detectAPGPeaks(apg: number): number[] {
    const peaks: number[] = [];
    const threshold = this.config.peakDetectionThreshold;
    const n = Math.min(this.bufferIndex, this.bufferSize);
    
    if (n < 10) return peaks;
    
    // Buscar peaks locales
    for (let i = 2; i < n - 2; i++) {
      const curr = this.vpgBuffer[i]!;
      const prev = this.vpgBuffer[i - 1]!;
      const next = this.vpgBuffer[i + 1]!;
      
      // Peak local y sobre threshold
      if (curr > prev && curr > next && Math.abs(curr) > threshold) {
        peaks.push(curr);
      }
    }
    
    return peaks;
  }

  /**
   * Calcula pendiente de upstroke sistólico
   */
  private computeSystolicUpstroke(): number {
    const n = Math.min(this.bufferIndex, this.bufferSize);
    if (n < 20) return 0;
    
    // Buscar mínimo local (diastole)
    let minIdx = n - 1;
    let minVal = Infinity;
    
    for (let i = Math.max(0, n - 20); i < n; i++) {
      const val = this.ppgBuffer[i]!;
      if (val < minVal) {
        minVal = val;
        minIdx = i;
      }
    }
    
    // Buscar máximo después del mínimo (systole)
    let maxIdx = minIdx;
    let maxVal = minVal;
    
    for (let i = minIdx; i < n; i++) {
      const val = this.ppgBuffer[i]!;
      if (val > maxVal) {
        maxVal = val;
        maxIdx = i;
      }
    }
    
    // Calcular pendiente
    if (maxIdx > minIdx) {
      const dx = maxIdx - minIdx;
      const dy = maxVal - minVal;
      return dy / (dx + 1e-6);
    }
    
    return 0;
  }

  /**
   * Calcula profundidad del dicrotic notch
   */
  private computeDicroticNotch(): number {
    const n = Math.min(this.bufferIndex, this.bufferSize);
    if (n < 30) return 0;
    
    // Analizar ventana reciente
    const window = 20;
    const start = Math.max(0, n - window);
    
    // Encontrar máximo (systole) y mínimo posterior (dicrotic notch)
    let maxVal = -Infinity;
    let maxIdx = start;
    let minVal = Infinity;
    let minIdx = start;
    
    for (let i = start; i < n; i++) {
      const val = this.ppgBuffer[i]!;
      if (val > maxVal) {
        maxVal = val;
        maxIdx = i;
      }
      if (val < minVal) {
        minVal = val;
        minIdx = i;
      }
    }
    
    // Si el mínimo está después del máximo, es el dicrotic notch
    if (minIdx > maxIdx) {
      const notchDepth = maxVal - minVal;
      const notchDepthNorm = notchDepth / (maxVal - minVal + 1e-6);
      return notchDepthNorm;
    }
    
    return 0;
  }

  /**
   * Obtiene buffer de PPG
   */
  getPPGBuffer(): Float32Array {
    return this.ppgBuffer;
  }

  /**
   * Obtiene buffer de VPG
   */
  getVPGBuffer(): Float32Array {
    return this.vpgBuffer;
  }

  reset(): void {
    this.ppgBuffer.fill(0);
    this.vpgBuffer.fill(0);
    this.bufferIndex = 0;
  }
}
