import { CircularBuffer } from '../utils/CircularBuffer';
import { FFT } from '../utils/FFT';

type StressLevel = 'muy_bajo' | 'bajo' | 'moderado' | 'alto' | 'muy_alto';

interface StressMetrics {
  level: StressLevel;
  score: number; // 0-100
  confidence: number; // 0-1
  hrvMetrics: {
    sdnn: number;
    rmssd: number;
    pnn50: number;
    lf: number;
    hf: number;
    lfHfRatio: number;
  };
  timestamp: number;
}

export class StressAnalyzer {
  private buffer: CircularBuffer;
  private fft: FFT;
  private baselineMetrics: {
    rmssd: number;
    lfHfRatio: number;
  } | null = null;
  private calibrationSamples: number = 0;
  private readonly CALIBRATION_DURATION = 180; // 3 minutos de calibración
  private readonly UPDATE_INTERVAL = 10000; // 10 segundos entre actualizaciones
  private lastUpdateTime: number = 0;
  
  // Umbrales para clasificación de estrés (se ajustan durante la calibración)
  private rmssdThresholds = {
    muy_bajo: 60,   // ms
    bajo: 50,
    moderado: 35,
    alto: 20,
    // muy_alto: < 20
  };
  
  private lfHfThresholds = {
    muy_bajo: 0.5,  // Relación LF/HF
    bajo: 1.0,
    moderado: 2.0,
    alto: 3.0,
    // muy_alto: > 3.0
  };

  constructor(bufferSize: number = 300, samplingRate: number = 30) {
    this.buffer = new CircularBuffer(bufferSize, samplingRate);
    this.fft = new FFT(256); // Tamaño de FFT fijo para consistencia
  }

  /**
   * Procesa un nuevo punto de datos PPG
   */
  processDataPoint(point: PPGDataPoint): void {
    this.buffer.push(point);
    
    // Actualizar análisis solo periódicamente
    const now = Date.now();
    if (now - this.lastUpdateTime >= this.UPDATE_INTERVAL) {
      this.lastUpdateTime = now;
      this.updateStressAnalysis();
    }
  }

  /**
   * Realiza la calibración inicial para establecer la línea base
   */
  calibrate(): void {
    // Reiniciar métricas de calibración
    this.baselineMetrics = {
      rmssd: 0,
      lfHfRatio: 0
    };
    this.calibrationSamples = 0;
    
    console.log('Iniciando calibración de estrés (3 minutos)...');
    
    // La calibración se realiza automáticamente durante el período de calibración
    setTimeout(() => {
      if (this.calibrationSamples > 0) {
        this.baselineMetrics!.rmssd /= this.calibrationSamples;
        this.baselineMetrics!.lfHfRatio /= this.calibrationSamples;
        
        // Ajustar umbrales según la línea base
        this.adjustThresholds();
        
        console.log('Calibración completada:', this.baselineMetrics);
      } else {
        console.warn('No se recopilaron suficientes datos durante la calibración');
      }
    }, this.CALIBRATION_DURATION * 1000);
  }

  /**
   * Ajusta los umbrales según la línea base del usuario
   */
  private adjustThresholds(): void {
    if (!this.baselineMetrics) return;
    
    // Ajustar umbrales basados en la línea base del usuario
    const baseRmssd = this.baselineMetrics.rmssd;
    const baseLfHf = this.baselineMetrics.lfHfRatio;
    
    // Ajustar umbrales de RMSSD (mayor RMSSD = menor estrés)
    this.rmssdThresholds = {
      muy_bajo: baseRmssd * 1.5,
      bajo: baseRmssd * 1.25,
      moderado: baseRmssd * 0.75,
      alto: baseRmssd * 0.5,
    };
    
    // Ajustar umbrales de LF/HF (mayor relación = mayor estrés)
    this.lfHfThresholds = {
      muy_bajo: baseLfHf * 0.5,
      bajo: baseLfHf * 0.75,
      moderado: baseLfHf * 1.25,
      alto: baseLfHf * 1.5,
    };
  }

  /**
   * Actualiza el análisis de estrés basado en los datos actuales
   */
  private updateStressAnalysis(): void {
    const points = this.buffer.getPoints();
    if (points.length < 100) return; // No hay suficientes datos
    
    // Extraer métricas de HRV
    const { rmssd, pnn50, sdnn, lf, hf, lfHfRatio } = this.calculateHRVMetrics(points);
    
    // Durante la calibración, recolectar métricas de referencia
    if (!this.baselineMetrics && this.calibrationSamples < 100) {
      if (rmssd > 0 && lfHfRatio > 0) {
        this.baselineMetrics = this.baselineMetrics || { rmssd: 0, lfHfRatio: 0 };
        this.baselineMetrics.rmssd += rmssd;
        this.baselineMetrics.lfHfRatio += lfHfRatio;
        this.calibrationSamples++;
      }
      return;
    }
    
    // Calcular nivel de estrés
    const stressScore = this.calculateStressScore(rmssd, lfHfRatio);
    const stressLevel = this.classifyStressLevel(rmssd, lfHfRatio);
    
    // Calcular confianza basada en la calidad de la señal
    const confidence = this.calculateConfidence(points);
    
    // Emitir resultados (podría ser un evento o callback)
    const result: StressMetrics = {
      level: stressLevel,
      score: stressScore,
      confidence,
      hrvMetrics: { rmssd, pnn50, sdnn, lf, hf, lfHfRatio },
      timestamp: Date.now()
    };
    
    this.onStressUpdate(result);
  }

  /**
   * Calcula métricas de HRV a partir de los puntos de datos
   */
  private calculateHRVMetrics(points: PPGDataPoint[]) {
    // Extraer intervalos RR
    const { rri, valid } = this.extractRRIntervals(points);
    if (!valid || rri.length < 5) {
      return { rmssd: 0, pnn50: 0, sdnn: 0, lf: 0, hf: 0, lfHfRatio: 0 };
    }
    
    // Calcular métricas en el dominio del tiempo
    const { rmssd, pnn50, sdnn } = this.calculateTimeDomainMetrics(rri);
    
    // Calcular métricas en el dominio de la frecuencia
    const { lf, hf, lfHfRatio } = this.calculateFrequencyDomainMetrics(rri);
    
    return { rmssd, pnn50, sdnn, lf, hf, lfHfRatio };
  }

  /**
   * Extrae los intervalos RR de la señal PPG
   */
  private extractRRIntervals(points: PPGDataPoint[]): { rri: number[]; valid: boolean } {
    const rri: number[] = [];
    let lastPeakTime = 0;
    let valid = true;
    
    // Detección de picos mejorada
    for (let i = 1; i < points.length - 1; i++) {
      const prev = points[i-1].value;
      const curr = points[i].value;
      const next = points[i+1].value;
      
      // Detección de pico simple
      if (curr > prev && curr > next && curr > 0.5) {
        const currentTime = points[i].time;
        
        if (lastPeakTime > 0) {
          const rrInterval = currentTime - lastPeakTime;
          
          // Validar que el intervalo sea fisiológicamente posible
          if (rrInterval < 300 || rrInterval > 1500) { // 200-1000 lpm
            valid = false;
            break;
          }
          
          rri.push(rrInterval);
        }
        
        lastPeakTime = currentTime;
      }
    }
    
    return { rri, valid };
  }

  /**
   * Calcula métricas de HRV en el dominio del tiempo
   */
  private calculateTimeDomainMetrics(rri: number[]) {
    const n = rri.length;
    const meanRR = rri.reduce((a, b) => a + b, 0) / n;
    
    // SDNN: Desviación estándar de los intervalos NN
    const sdnn = Math.sqrt(
      rri.reduce((sum, rr) => sum + Math.pow(rr - meanRR, 2), 0) / n
    );
    
    // RMSSD: Raíz cuadrada de la media de las diferencias sucesivas al cuadrado
    let sumSqDiff = 0;
    for (let i = 1; i < n; i++) {
      sumSqDiff += Math.pow(rri[i] - rri[i-1], 2);
    }
    const rmssd = Math.sqrt(sumSqDiff / (n - 1));
    
    // pNN50: Porcentaje de diferencias sucesivas > 50ms
    let nn50 = 0;
    for (let i = 1; i < n; i++) {
      if (Math.abs(rri[i] - rri[i-1]) > 50) {
        nn50++;
      }
    }
    const pnn50 = (nn50 / (n - 1)) * 100;
    
    return { rmssd, pnn50, sdnn };
  }

  /**
   * Calcula métricas de HRV en el dominio de la frecuencia
   */
  private calculateFrequencyDomainMetrics(rri: number[]) {
    // Interpolar los intervalos RR a una señal equiespaciada
    const interpolated = this.interpolateRRIntervals(rri, 4); // 4 Hz
    
    if (interpolated.length < this.fft.size) {
      return { lf: 0, hf: 0, lfHfRatio: 0 };
    }
    
    // Aplicar ventana de Hamming
    const windowed = FFT.applyWindow(interpolated, 'hamming');
    
    // Calcular FFT
    const fftResult = this.fft.forward(new Float32Array(windowed));
    const psd = this.fft.powerSpectralDensity(fftResult);
    const freqs = this.fft.frequencies(4); // 4 Hz de frecuencia de muestreo
    
    // Calcular potencia en bandas de frecuencia
    const bands = FFT.bandPower(psd, freqs, [
      0.0033, 0.04,   // VLF
      0.04, 0.15,     // LF
      0.15, 0.4       // HF
    ]);
    
    const vlf = bands[0]?.power || 0;
    const lf = bands[1]?.power || 0;
    const hf = bands[2]?.power || 0;
    
    // Calcular relación LF/HF (indicador de estrés)
    const lfHfRatio = hf > 0 ? lf / hf : 0;
    
    return { lf, hf, lfHfRatio };
  }

  /**
   * Interpola los intervalos RR a una señal equiespaciada
   */
  private interpolateRRIntervals(rri: number[], sampleRate: number): number[] {
    const n = rri.length;
    if (n < 2) return [];
    
    // Calcular tiempos acumulativos
    const times = new Array(n);
    times[0] = 0;
    
    for (let i = 1; i < n; i++) {
      times[i] = times[i-1] + rri[i-1];
    }
    
    const totalTime = times[times.length - 1] + rri[rri.length - 1];
    const numSamples = Math.ceil((totalTime / 1000) * sampleRate);
    const result = new Array(numSamples).fill(0);
    
    // Interpolación lineal
    let rrIndex = 0;
    for (let i = 0; i < numSamples; i++) {
      const t = (i / sampleRate) * 1000; // Tiempo en ms
      
      // Avanzar al intervalo RR correcto
      while (rrIndex < n - 1 && t > times[rrIndex + 1]) {
        rrIndex++;
      }
      
      // Interpolación lineal
      if (rrIndex < n - 1) {
        const t0 = times[rrIndex];
        const t1 = times[rrIndex + 1];
        const y0 = rri[rrIndex];
        const y1 = rri[rrIndex + 1];
        
        result[i] = y0 + ((y1 - y0) * (t - t0)) / (t1 - t0);
      } else {
        result[i] = rri[rrIndex];
      }
    }
    
    return result;
  }

  /**
   * Calcula el puntaje de estrés basado en las métricas de HRV
   */
  private calculateStressScore(rmssd: number, lfHfRatio: number): number {
    // Normalizar RMSSD (inversamente relacionado con el estrés)
    const maxRmssd = 100; // Valor máximo típico
    const rmssdScore = Math.max(0, Math.min(100, (rmssd / maxRmssd) * 100));
    
    // Normalizar LF/HF (directamente relacionado con el estrés)
    const maxLfHf = 5.0; // Valor máximo típico
    const lfHfScore = Math.max(0, Math.min(100, (lfHfRatio / maxLfHf) * 100));
    
    // Combinar puntuaciones (ponderación: 60% RMSSD, 40% LF/HF)
    return (rmssdScore * 0.6) + ((100 - lfHfScore) * 0.4);
  }

  /**
   * Clasifica el nivel de estrés basado en las métricas
   */
  private classifyStressLevel(rmssd: number, lfHfRatio: number): StressLevel {
    // Clasificación basada en RMSSD (mayor = menos estrés)
    let rmssdLevel: StressLevel = 'muy_alto';
    
    if (rmssd >= this.rmssdThresholds.muy_bajo) rmssdLevel = 'muy_bajo';
    else if (rmssd >= this.rmssdThresholds.bajo) rmssdLevel = 'bajo';
    else if (rmssd >= this.rmssdThresholds.moderado) rmssdLevel = 'moderado';
    else if (rmssd >= this.rmssdThresholds.alto) rmssdLevel = 'alto';
    
    // Clasificación basada en LF/HF (mayor = más estrés)
    let lfHfLevel: StressLevel = 'muy_bajo';
    
    if (lfHfRatio >= this.lfHfThresholds.alto) lfHfLevel = 'muy_alto';
    else if (lfHfRatio >= this.lfHfThresholds.moderado) lfHfLevel = 'alto';
    else if (lfHfRatio >= this.lfHfThresholds.bajo) lfHfLevel = 'moderado';
    else if (lfHfRatio >= this.lfHfThresholds.muy_bajo) lfHfLevel = 'bajo';
    
    // Combinar clasificaciones (promedio simple de los niveles)
    const levels: StressLevel[] = ['muy_bajo', 'bajo', 'moderado', 'alto', 'muy_alto'];
    const rmssdIndex = levels.indexOf(rmssdLevel);
    const lfHfIndex = levels.indexOf(lfHfLevel);
    const avgIndex = Math.round((rmssdIndex + lfHfIndex) / 2);
    
    return levels[Math.min(levels.length - 1, Math.max(0, avgIndex))];
  }

  /**
   * Calcula la confianza en el análisis basada en la calidad de la señal
   */
  private calculateConfidence(points: PPGDataPoint[]): number {
    // 1. Calcular relación señal/ruido
    const values = points.map(p => p.value);
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const variance = values.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / values.length;
    const stdDev = Math.sqrt(variance);
    const snr = stdDev > 0 ? mean / stdDev : 0;
    
    // 2. Verificar regularidad de los latidos
    const { rri, valid } = this.extractRRIntervals(points);
    let regularityScore = 0;
    
    if (valid && rri.length >= 5) {
      const meanRR = rri.reduce((a, b) => a + b, 0) / rri.length;
      const rrVariance = rri.reduce((sum, rr) => sum + Math.pow(rr - meanRR, 2), 0) / rri.length;
      const rrStdDev = Math.sqrt(rrVariance);
      
      // Desviación estándar normalizada (coeficiente de variación)
      const cv = rrStdDev / meanRR;
      
      // Puntuación de regularidad (menor CV = más regular)
      regularityScore = Math.max(0, 1 - Math.min(1, cv * 10));
    }
    
    // 3. Combinar métricas de confianza
    const snrScore = Math.min(1, snr / 5); // Normalizar SNR a 0-1
    const finalConfidence = (snrScore * 0.6) + (regularityScore * 0.4);
    
    return Math.max(0, Math.min(1, finalConfidence));
  }

  /**
   * Maneja las actualizaciones del análisis de estrés
   */
  private onStressUpdate(metrics: StressMetrics): void {
    // Implementar lógica para manejar las actualizaciones
    // Por ejemplo, emitir un evento o llamar a un callback
    console.log('Actualización de estrés:', metrics);
    
    // Ejemplo de implementación con eventos:
    // this.emit('stressUpdate', metrics);
  }

  /**
   * Reinicia el analizador de estrés
   */
  reset(): void {
    this.buffer.clear();
    this.baselineMetrics = null;
    this.calibrationSamples = 0;
  }
}
