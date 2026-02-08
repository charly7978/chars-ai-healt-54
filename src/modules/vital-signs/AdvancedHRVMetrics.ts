/**
 * MÉTRICAS AVANZADAS DE HRV (VARIABILIDAD DE FRECUENCIA CARDÍACA)
 * 
 * Basado en literatura científica:
 * - Task Force ESC/NASPE (1996): Estándar de oro para HRV
 * - MIT/Stanford Labs: Métricas no lineales
 * - Massachusetts General Hospital: Sample Entropy
 * 
 * MÉTRICAS IMPLEMENTADAS:
 * 
 * 1. DOMINIO TEMPORAL:
 *    - SDNN: Desviación estándar de intervalos NN
 *    - RMSSD: Raíz cuadrada media de diferencias sucesivas
 *    - pNN50: % de diferencias > 50ms
 *    - pNNx: % de diferencias > x ms (parametrizable)
 * 
 * 2. DOMINIO FRECUENCIAL:
 *    - VLF: 0.003-0.04 Hz (muy baja frecuencia)
 *    - LF: 0.04-0.15 Hz (baja frecuencia - simpático)
 *    - HF: 0.15-0.4 Hz (alta frecuencia - parasimpático)
 *    - LF/HF ratio: Balance autonómico
 * 
 * 3. MÉTRICAS NO LINEALES:
 *    - DFA α1: Detrended Fluctuation Analysis (corto plazo)
 *    - DFA α2: DFA largo plazo
 *    - ApEn: Approximate Entropy (regularidad)
 *    - SampEn: Sample Entropy (complejidad)
 */

export interface HRVMetrics {
  // Dominio temporal
  temporal: {
    meanRR: number;      // Promedio de intervalos RR (ms)
    sdnn: number;        // Desviación estándar (ms)
    rmssd: number;       // RMSSD (ms)
    pnn50: number;       // % de diferencias > 50ms
    pnn20: number;       // % de diferencias > 20ms
    cv: number;          // Coeficiente de variación (%)
  };
  
  // Dominio frecuencial
  frequency: {
    vlf: number;         // Potencia VLF (ms²)
    lf: number;          // Potencia LF (ms²)
    hf: number;          // Potencia HF (ms²)
    lfHfRatio: number;   // Ratio LF/HF
    totalPower: number;  // Potencia total (ms²)
    lfNorm: number;      // LF normalizado (%)
    hfNorm: number;      // HF normalizado (%)
  };
  
  // Métricas no lineales
  nonLinear: {
    dfaAlpha1: number;   // DFA corto plazo (4-16 beats)
    dfaAlpha2: number;   // DFA largo plazo (16-64 beats)
    approximateEntropy: number;  // ApEn
    sampleEntropy: number;       // SampEn
  };
  
  // Índices derivados
  indices: {
    stressIndex: number;      // Índice de estrés (basado en LF/HF)
    recoveryIndex: number;    // Índice de recuperación (basado en HF)
    autonomicBalance: number; // Balance autonómico (-1 a +1)
    healthScore: number;      // Score general 0-100
  };
}

export class AdvancedHRVMetrics {
  private readonly MIN_INTERVALS = 20;
  private readonly sampleRate: number;
  
  constructor(sampleRate: number = 30) {
    this.sampleRate = sampleRate;
    console.log('✅ AdvancedHRVMetrics inicializado');
  }
  
  /**
   * CALCULAR TODAS LAS MÉTRICAS HRV
   */
  calculate(rrIntervals: number[]): HRVMetrics {
    // Filtrar intervalos válidos (200-2000ms = 30-300 BPM)
    const validIntervals = rrIntervals.filter(rr => rr >= 200 && rr <= 2000);
    
    if (validIntervals.length < this.MIN_INTERVALS) {
      return this.emptyMetrics();
    }
    
    // Calcular métricas por dominio
    const temporal = this.calculateTemporalMetrics(validIntervals);
    const frequency = this.calculateFrequencyMetrics(validIntervals);
    const nonLinear = this.calculateNonLinearMetrics(validIntervals);
    const indices = this.calculateDerivedIndices(temporal, frequency, nonLinear);
    
    return {
      temporal,
      frequency,
      nonLinear,
      indices
    };
  }
  
  /**
   * MÉTRICAS EN DOMINIO TEMPORAL
   */
  private calculateTemporalMetrics(intervals: number[]): HRVMetrics['temporal'] {
    const n = intervals.length;
    
    // Mean RR
    const meanRR = intervals.reduce((a, b) => a + b, 0) / n;
    
    // SDNN: desviación estándar
    const sdnn = Math.sqrt(
      intervals.reduce((sum, rr) => sum + Math.pow(rr - meanRR, 2), 0) / n
    );
    
    // Diferencias sucesivas
    const diffs: number[] = [];
    for (let i = 1; i < n; i++) {
      diffs.push(intervals[i] - intervals[i - 1]);
    }
    
    // RMSSD
    const rmssd = Math.sqrt(
      diffs.reduce((sum, d) => sum + d * d, 0) / diffs.length
    );
    
    // pNN50 y pNN20
    const pnn50 = (diffs.filter(d => Math.abs(d) > 50).length / diffs.length) * 100;
    const pnn20 = (diffs.filter(d => Math.abs(d) > 20).length / diffs.length) * 100;
    
    // Coeficiente de variación
    const cv = (sdnn / meanRR) * 100;
    
    return { meanRR, sdnn, rmssd, pnn50, pnn20, cv };
  }
  
  /**
   * MÉTRICAS EN DOMINIO FRECUENCIAL (via Lomb-Scargle periodogram)
   */
  private calculateFrequencyMetrics(intervals: number[]): HRVMetrics['frequency'] {
    // Construir serie temporal
    const times: number[] = [0];
    for (let i = 1; i < intervals.length; i++) {
      times.push(times[i - 1] + intervals[i - 1]);
    }
    
    // Centrar la señal
    const mean = intervals.reduce((a, b) => a + b, 0) / intervals.length;
    const centered = intervals.map(v => v - mean);
    
    // Calcular potencia espectral en bandas
    const vlf = this.calculateBandPower(times, centered, 0.003, 0.04);
    const lf = this.calculateBandPower(times, centered, 0.04, 0.15);
    const hf = this.calculateBandPower(times, centered, 0.15, 0.4);
    
    const totalPower = vlf + lf + hf;
    const lfHfRatio = hf > 0 ? lf / hf : 0;
    
    // Potencias normalizadas (excluye VLF)
    const lfNorm = (lf + hf) > 0 ? (lf / (lf + hf)) * 100 : 0;
    const hfNorm = (lf + hf) > 0 ? (hf / (lf + hf)) * 100 : 0;
    
    return { vlf, lf, hf, lfHfRatio, totalPower, lfNorm, hfNorm };
  }
  
  /**
   * CALCULAR POTENCIA EN UNA BANDA DE FRECUENCIA
   * Simplificación del periodograma de Lomb-Scargle
   */
  private calculateBandPower(
    times: number[],
    values: number[],
    fMin: number,
    fMax: number
  ): number {
    const n = values.length;
    if (n < 10) return 0;
    
    // Frecuencias a evaluar
    const nFreqs = 50;
    const freqs: number[] = [];
    for (let i = 0; i < nFreqs; i++) {
      freqs.push(fMin + (fMax - fMin) * (i / (nFreqs - 1)));
    }
    
    // Calcular potencia en cada frecuencia (aproximación)
    let totalPower = 0;
    
    for (const f of freqs) {
      const omega = 2 * Math.PI * f;
      
      let cosSum = 0;
      let sinSum = 0;
      
      for (let i = 0; i < n; i++) {
        const t = times[i] / 1000; // Convertir a segundos
        cosSum += values[i] * Math.cos(omega * t);
        sinSum += values[i] * Math.sin(omega * t);
      }
      
      // Potencia en esta frecuencia
      const power = (cosSum * cosSum + sinSum * sinSum) / n;
      totalPower += power;
    }
    
    return totalPower / nFreqs;
  }
  
  /**
   * MÉTRICAS NO LINEALES
   */
  private calculateNonLinearMetrics(intervals: number[]): HRVMetrics['nonLinear'] {
    // DFA (Detrended Fluctuation Analysis)
    const dfaAlpha1 = this.calculateDFA(intervals, 4, 16);
    const dfaAlpha2 = this.calculateDFA(intervals, 16, Math.min(64, Math.floor(intervals.length / 4)));
    
    // Approximate Entropy
    const approximateEntropy = this.calculateApproximateEntropy(intervals, 2, 0.2);
    
    // Sample Entropy
    const sampleEntropy = this.calculateSampleEntropy(intervals, 2, 0.2);
    
    return { dfaAlpha1, dfaAlpha2, approximateEntropy, sampleEntropy };
  }
  
  /**
   * DFA (DETRENDED FLUCTUATION ANALYSIS)
   * 
   * Mide correlaciones a largo plazo en la señal
   * α1 < 1.0 puede indicar patología cardíaca
   */
  private calculateDFA(intervals: number[], minScale: number, maxScale: number): number {
    const n = intervals.length;
    if (n < maxScale * 2) return 0;
    
    // Integrar la señal (suma acumulativa centrada)
    const mean = intervals.reduce((a, b) => a + b, 0) / n;
    const integrated: number[] = [];
    let sum = 0;
    for (const rr of intervals) {
      sum += rr - mean;
      integrated.push(sum);
    }
    
    // Calcular fluctuación para diferentes escalas
    const scales: number[] = [];
    const fluctuations: number[] = [];
    
    for (let scale = minScale; scale <= maxScale; scale += 2) {
      const numBoxes = Math.floor(n / scale);
      if (numBoxes < 2) continue;
      
      let totalFluctuation = 0;
      
      for (let box = 0; box < numBoxes; box++) {
        const start = box * scale;
        const end = start + scale;
        
        // Ajustar línea de tendencia (regresión lineal)
        const segment = integrated.slice(start, end);
        const { slope, intercept } = this.linearRegression(segment);
        
        // Calcular fluctuación (RMS del residuo)
        let residualSum = 0;
        for (let i = 0; i < segment.length; i++) {
          const trend = intercept + slope * i;
          residualSum += Math.pow(segment[i] - trend, 2);
        }
        
        totalFluctuation += Math.sqrt(residualSum / scale);
      }
      
      scales.push(scale);
      fluctuations.push(totalFluctuation / numBoxes);
    }
    
    if (scales.length < 3) return 0;
    
    // Calcular α como pendiente del log-log plot
    const logScales = scales.map(s => Math.log(s));
    const logFluc = fluctuations.map(f => Math.log(Math.max(0.001, f)));
    
    const { slope } = this.linearRegression(logFluc, logScales);
    
    return slope;
  }
  
  /**
   * APPROXIMATE ENTROPY (ApEn)
   * 
   * Mide regularidad de la señal
   * ApEn bajo = más regular (puede indicar patología)
   */
  private calculateApproximateEntropy(
    data: number[],
    m: number = 2,
    rFactor: number = 0.2
  ): number {
    const n = data.length;
    if (n < 10) return 0;
    
    const r = rFactor * this.std(data);
    
    const phi = (m: number): number => {
      const patterns: number[][] = [];
      
      for (let i = 0; i <= n - m; i++) {
        patterns.push(data.slice(i, i + m));
      }
      
      let sum = 0;
      
      for (let i = 0; i < patterns.length; i++) {
        let count = 0;
        
        for (let j = 0; j < patterns.length; j++) {
          const maxDist = Math.max(...patterns[i].map((v, k) => Math.abs(v - patterns[j][k])));
          if (maxDist <= r) count++;
        }
        
        sum += Math.log(count / patterns.length);
      }
      
      return sum / patterns.length;
    };
    
    return phi(m) - phi(m + 1);
  }
  
  /**
   * SAMPLE ENTROPY (SampEn)
   * 
   * Similar a ApEn pero más robusto
   * No cuenta auto-matches
   */
  private calculateSampleEntropy(
    data: number[],
    m: number = 2,
    rFactor: number = 0.2
  ): number {
    const n = data.length;
    if (n < 10) return 0;
    
    const r = rFactor * this.std(data);
    
    const countMatches = (m: number): number => {
      let count = 0;
      
      for (let i = 0; i <= n - m - 1; i++) {
        for (let j = i + 1; j <= n - m; j++) {
          let match = true;
          
          for (let k = 0; k < m; k++) {
            if (Math.abs(data[i + k] - data[j + k]) > r) {
              match = false;
              break;
            }
          }
          
          if (match) count++;
        }
      }
      
      return count;
    };
    
    const A = countMatches(m + 1);
    const B = countMatches(m);
    
    if (B === 0 || A === 0) return 0;
    
    return -Math.log(A / B);
  }
  
  /**
   * ÍNDICES DERIVADOS
   */
  private calculateDerivedIndices(
    temporal: HRVMetrics['temporal'],
    frequency: HRVMetrics['frequency'],
    nonLinear: HRVMetrics['nonLinear']
  ): HRVMetrics['indices'] {
    
    // Índice de estrés: basado en LF/HF y reducción de HRV
    const stressIndex = Math.min(100, 
      (frequency.lfHfRatio * 25) + 
      (100 - Math.min(100, temporal.sdnn)) * 0.5
    );
    
    // Índice de recuperación: basado en HF y RMSSD
    const recoveryIndex = Math.min(100,
      (frequency.hfNorm * 0.5) +
      (Math.min(100, temporal.rmssd) * 0.5)
    );
    
    // Balance autonómico: -1 (simpático) a +1 (parasimpático)
    const autonomicBalance = Math.max(-1, Math.min(1,
      (frequency.hfNorm - frequency.lfNorm) / 50
    ));
    
    // Health Score: combinación de todas las métricas
    let healthScore = 50;
    
    // SDNN contribución (30-100ms es bueno)
    if (temporal.sdnn >= 30 && temporal.sdnn <= 100) {
      healthScore += 15;
    } else if (temporal.sdnn > 100) {
      healthScore += 10;
    }
    
    // RMSSD contribución (>20ms es bueno)
    if (temporal.rmssd > 20) {
      healthScore += 10;
    }
    
    // DFA α1 contribución (0.75-1.25 es normal)
    if (nonLinear.dfaAlpha1 >= 0.75 && nonLinear.dfaAlpha1 <= 1.25) {
      healthScore += 15;
    }
    
    // LF/HF ratio (1-2 es normal)
    if (frequency.lfHfRatio >= 1 && frequency.lfHfRatio <= 2) {
      healthScore += 10;
    }
    
    return {
      stressIndex: Math.round(stressIndex),
      recoveryIndex: Math.round(recoveryIndex),
      autonomicBalance: Math.round(autonomicBalance * 100) / 100,
      healthScore: Math.min(100, Math.max(0, Math.round(healthScore)))
    };
  }
  
  /**
   * REGRESIÓN LINEAL
   */
  private linearRegression(y: number[], x?: number[]): { slope: number; intercept: number } {
    const n = y.length;
    const xVals = x || Array.from({ length: n }, (_, i) => i);
    
    const sumX = xVals.reduce((a, b) => a + b, 0);
    const sumY = y.reduce((a, b) => a + b, 0);
    const sumXY = xVals.reduce((sum, xi, i) => sum + xi * y[i], 0);
    const sumX2 = xVals.reduce((sum, xi) => sum + xi * xi, 0);
    
    const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
    const intercept = (sumY - slope * sumX) / n;
    
    return { slope, intercept };
  }
  
  /**
   * DESVIACIÓN ESTÁNDAR
   */
  private std(data: number[]): number {
    const mean = data.reduce((a, b) => a + b, 0) / data.length;
    const variance = data.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / data.length;
    return Math.sqrt(variance);
  }
  
  /**
   * MÉTRICAS VACÍAS
   */
  private emptyMetrics(): HRVMetrics {
    return {
      temporal: { meanRR: 0, sdnn: 0, rmssd: 0, pnn50: 0, pnn20: 0, cv: 0 },
      frequency: { vlf: 0, lf: 0, hf: 0, lfHfRatio: 0, totalPower: 0, lfNorm: 0, hfNorm: 0 },
      nonLinear: { dfaAlpha1: 0, dfaAlpha2: 0, approximateEntropy: 0, sampleEntropy: 0 },
      indices: { stressIndex: 0, recoveryIndex: 0, autonomicBalance: 0, healthScore: 0 }
    };
  }
}
