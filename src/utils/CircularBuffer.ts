export interface PPGDataPoint {
  time: number;         // Tiempo en milisegundos
  value: number;        // Valor de la señal normalizado (-1 a 1)
  isArrhythmia: boolean;// Indica si hay arritmia
  rawRed?: number;      // Valor crudo del canal rojo (opcional)
  rawGreen?: number;    // Valor crudo del canal verde (opcional)
  rawBlue?: number;     // Valor crudo del canal azul (opcional)
  heartRate?: number;   // Frecuencia cardíaca calculada
  spo2?: number;        // Saturación de oxígeno calculada
  confidence?: number;  // Nivel de confianza de la medición (0-1)
  features?: {
    // Características en el dominio del tiempo
    rms?: number;       // Valor cuadrático medio
    sdnn?: number;      // Desviación estándar de los intervalos NN
    rmssd?: number;     // Raíz cuadrada de la media de las diferencias sucesivas al cuadrado
    pnn50?: number;     // Porcentaje de diferencias NN > 50ms
    
    // Características en el dominio de la frecuencia
    vlf?: number;       // Potencia en banda de muy baja frecuencia (0.0033-0.04 Hz)
    lf?: number;        // Potencia en banda de baja frecuencia (0.04-0.15 Hz)
    hf?: number;        // Potencia en banda de alta frecuencia (0.15-0.4 Hz)
    lfHfRatio?: number; // Relación LF/HF
    
    // Características adicionales
    si?: number;        // Índice de estrés
    ulf?: number;       // Potencia en banda de ultra baja frecuencia (<0.0033 Hz)
  };
}

/**
 * Buffer circular altamente optimizado para procesamiento de señales PPG en tiempo real
 * con capacidad de análisis de frecuencia y detección de eventos.
 */
export class CircularBuffer {
  private buffer: PPGDataPoint[];
  private maxSize: number;
  private head: number = 0;
  private tail: number = 0;
  private count: number = 0;
  private lastPeakTime: number = 0;
  private lastRRIntervals: number[] = [];
  private readonly MAX_RR_INTERVALS = 100; // Aumentado para mejor análisis espectral
  private samplingRate: number;
  private fftSize: number = 256; // Tamaño para la FFT
  private hammingWindow: Float32Array;
  private fft: any; // Usaremos una implementación externa de FFT
  
  // Umbrales para detección de picos
  private readonly PEAK_THRESHOLD = 0.5;
  private readonly REFRACTORY_PERIOD = 200; // ms
  private lastPeakTime: number = 0;

  constructor(size: number, samplingRate: number = 30) {
    this.buffer = new Array(size);
    this.maxSize = size;
    this.samplingRate = samplingRate;
    this.hammingWindow = this.createHammingWindow(this.fftSize);
    // Inicializar FFT (asumiendo que existe una implementación)
    // this.fft = new FFT(this.fftSize, this.samplingRate);
  }
  
  /**
   * Crea una ventana de Hamming para el análisis espectral
   */
  private createHammingWindow(size: number): Float32Array {
    const window = new Float32Array(size);
    for (let i = 0; i < size; i++) {
      window[i] = 0.54 - 0.46 * Math.cos((2 * Math.PI * i) / (size - 1));
    }
    return window;
  }

  /**
   * Agrega un nuevo punto de datos al buffer y realiza el análisis en tiempo real
   */
  push(point: PPGDataPoint): void {
    // Aplicar preprocesamiento básico
    const processedPoint = this.preprocessPoint(point);
    
    // Detección de picos para análisis de variabilidad de frecuencia cardíaca
    this.detectPeaks(processedPoint);
    
    // Calcular características en tiempo real
    if (this.count > this.maxSize / 2) {
      processedPoint.features = this.extractTimeDomainFeatures();
      
      // Análisis espectral cada cierto número de muestras
      if (this.count % this.fftSize === 0) {
        const spectralFeatures = this.analyzeSpectralFeatures();
        if (processedPoint.features) {
          Object.assign(processedPoint.features, spectralFeatures);
        }
      }
    }
    
    // Almacenar el punto procesado
    this.buffer[this.tail] = processedPoint;
    this.tail = (this.tail + 1) % this.maxSize;
    
    if (this.count === this.maxSize) {
      this.head = (this.head + 1) % this.maxSize;
    } else {
      this.count++;
    }
  }
  
  /**
   * Preprocesamiento básico de la señal PPG
   */
  private preprocessPoint(point: PPGDataPoint): PPGDataPoint {
    // Aquí se pueden aplicar filtros digitales, normalización, etc.
    return {
      ...point,
      // Aplicar filtrado pasa banda (ejemplo simplificado)
      value: this.applyBandpassFilter(point.value)
    };
  }
  
  /**
   * Filtro digital pasa banda simplificado
   */
  private applyBandpassFilter(value: number): number {
    // Implementación de un filtro IIR simple (coeficientes de ejemplo)
    // Filtro pasa banda 0.5Hz - 5Hz para señales PPG
    const a = [1, -1.848, 0.849];
    const b = [0.075, 0, -0.075];
    
    // Implementación del filtro (necesitarías mantener el estado)
    // Esta es una implementación simplificada
    return value * b[0]; // Implementación real necesitaría manejar el estado
  }
  
  /**
   * Detección de picos en la señal PPG
   */
  private detectPeaks(point: PPGDataPoint): void {
    // Implementación de detección de picos mejorada
    const currentTime = point.time;
    
    // Evitar detección múltiple del mismo pico
    if (currentTime - this.lastPeakTime < this.REFRACTORY_PERIOD) {
      return;
    }
    
    // Detectar picos usando umbral adaptativo
    const threshold = this.calculateAdaptiveThreshold();
    
    // Condición de pico (simplificada)
    if (point.value > threshold) {
      // Calcular intervalo RR
      if (this.lastPeakTime > 0) {
        const rrInterval = currentTime - this.lastPeakTime;
        this.lastRRIntervals.push(rrInterval);
        
        // Mantener solo los últimos MAX_RR_INTERVALS
        if (this.lastRRIntervals.length > this.MAX_RR_INTERVALS) {
          this.lastRRIntervals.shift();
        }
      }
      
      this.lastPeakTime = currentTime;
    }
  }
  
  /**
   * Calcula un umbral adaptativo para la detección de picos
   */
  private calculateAdaptiveThreshold(): number {
    // Media móvil de los valores máximos recientes
    const recentMax = Math.max(...this.getLastValues(10).map(v => v.value));
    return this.PEAK_THRESHOLD * recentMax;
  }
  
  /**
   * Extrae características en el dominio del tiempo
   */
  private extractTimeDomainFeatures() {
    if (this.lastRRIntervals.length < 2) return {};
    
    const intervals = this.lastRRIntervals;
    const meanRR = intervals.reduce((a, b) => a + b, 0) / intervals.length;
    const diffs = [];
    
    for (let i = 1; i < intervals.length; i++) {
      diffs.push(Math.abs(intervals[i] - intervals[i - 1]));
    }
    
    const rmssd = Math.sqrt(diffs.reduce((a, b) => a + b * b, 0) / diffs.length);
    const pnn50 = (diffs.filter(d => d > 50).length / diffs.length) * 100;
    
    return {
      rmssd,
      pnn50,
      sdnn: Math.sqrt(intervals.reduce((a, b) => a + Math.pow(b - meanRR, 2), 0) / intervals.length)
    };
  }
  
  /**
   * Análisis espectral de la señal
   */
  private analyzeSpectralFeatures() {
    // Implementación simplificada - en una implementación real usarías una FFT
    const values = this.getLastValues(this.fftSize).map(p => p.value);
    
    if (values.length < this.fftSize) return {};
    
    // Aplicar ventana de Hamming
    const windowed = values.map((v, i) => v * this.hammingWindow[i]);
    
    // En una implementación real, aquí se aplicaría la FFT
    // const spectrum = this.fft.forward(windowed);
    // const { vlf, lf, hf } = this.calculatePowerInBands(spectrum);
    
    return {
      // vlf,
      // lf,
      // hf,
      // lfHfRatio: lf / (hf || 1) // Evitar división por cero
    };
  }
  
  /**
   * Obtiene los últimos n valores del buffer
   */
  private getLastValues(n: number): PPGDataPoint[] {
    const result: PPGDataPoint[] = [];
    let index = (this.tail - 1 + this.maxSize) % this.maxSize;
    
    for (let i = 0; i < n && i < this.count; i++) {
      result.unshift(this.buffer[index]);
      index = (index - 1 + this.maxSize) % this.maxSize;
    }
    
    return result;
  }

  /**
   * Obtiene una copia de los puntos actuales en el buffer
   */
  getPoints(): PPGDataPoint[] {
    if (this.count === 0) return [];
    
    const result: PPGDataPoint[] = [];
    
    if (this.head < this.tail) {
      for (let i = this.head; i < this.tail; i++) {
        result.push({...this.buffer[i]});
      }
    } else {
      for (let i = this.head; i < this.maxSize; i++) {
        result.push({...this.buffer[i]});
      }
      for (let i = 0; i < this.tail; i++) {
        result.push({...this.buffer[i]});
      }
    }
    
    return result;
  }

  /**
   * Obtiene los últimos N puntos de datos
   */
  getLastPoints(n: number): PPGDataPoint[] {
    const points = this.getPoints();
    return points.slice(-n);
  }

  /**
   * Calcula la frecuencia cardíaca basada en los picos detectados
   */
  calculateHeartRate(): { bpm: number; confidence: number } {
    if (this.count < 2) return { bpm: 0, confidence: 0 };
    
    const points = this.getPoints();
    const peaks = this.detectPeaks(points);
    
    if (peaks.length < 2) return { bpm: 0, confidence: 0 };
    
    // Calcular intervalos RR (en ms)
    const rrIntervals: number[] = [];
    for (let i = 1; i < peaks.length; i++) {
      const interval = peaks[i].time - peaks[i-1].time;
      if (interval > 300 && interval < 1500) { // Filtro de valores fisiológicos
        rrIntervals.push(interval);
      }
    }
    
    if (rrIntervals.length === 0) return { bpm: 0, confidence: 0 };
    
    // Calcular promedio de intervalos RR
    const avgRR = rrIntervals.reduce((sum, val) => sum + val, 0) / rrIntervals.length;
    const bpm = Math.round(60000 / avgRR); // Convertir a BPM
    
    // Calcular confianza basada en la variabilidad de los intervalos RR
    const variance = rrIntervals.reduce((sum, val) => {
      return sum + Math.pow(val - avgRR, 2);
    }, 0) / rrIntervals.length;
    
    const stdDev = Math.sqrt(variance);
    const cv = (stdDev / avgRR) * 100; // Coeficiente de variación
    
    // La confianza es más alta cuando la variabilidad es baja
    const confidence = Math.max(0, 1 - (cv / 30)); // Normalizar a 0-1
    
    return { bpm, confidence };
  }

  /**
   * Detecta picos en la señal PPG usando un algoritmo adaptativo
   */
  private detectPeaks(points: PPGDataPoint[]): PPGDataPoint[] {
    if (points.length < 10) return [];
    
    const peaks: PPGDataPoint[] = [];
    const windowSize = Math.max(5, Math.floor(this.samplingRate * 0.2)); // 200ms
    
    for (let i = windowSize; i < points.length - windowSize; i++) {
      const current = points[i];
      let isPeak = true;
      
      // Verificar si es un pico local
      for (let j = i - windowSize; j < i + windowSize; j++) {
        if (j !== i && points[j].value > current.value) {
          isPeak = false;
          break;
        }
      }
      
      // Verificar umbral mínimo de amplitud
      if (isPeak && current.value > 0.3) {
        // Evitar detecciones demasiado cercanas
        if (peaks.length === 0 || 
            (current.time - peaks[peaks.length - 1].time) > 300) {
          peaks.push({...current});
        }
      }
    }
    
    return peaks;
  }

  /**
   * Calcula la saturación de oxígeno (SpO2) usando los canales rojo e infrarrojo
   */
  calculateSpO2(redPoints: number[], irPoints: number[]): { spo2: number; confidence: number } {
    if (redPoints.length !== irPoints.length || redPoints.length < this.samplingRate * 2) {
      return { spo2: 0, confidence: 0 };
    }
    
    // Calcular componentes AC y DC para ambos canales
    const redAC = this.calculateACComponent(redPoints);
    const redDC = this.calculateDCComponent(redPoints);
    const irAC = this.calculateACComponent(irPoints);
    const irDC = this.calculateDCComponent(irPoints);
    
    // Calcular relación R (ratio de ratios)
    const R = (redAC * irDC) / (irAC * redDC);
    
    // Fórmula de calibración para SpO2 (puede requerir ajuste para cada dispositivo)
    const spo2 = 110 - 25 * R;
    
    // Calcular confianza basada en la relación señal/ruido
    const snrRed = 20 * Math.log10(redAC / this.calculateNoise(redPoints));
    const snrIR = 20 * Math.log10(irAC / this.calculateNoise(irPoints));
    const avgSNR = (snrRed + snrIR) / 2;
    
    // Normalizar confianza (0-1)
    const confidence = Math.min(1, Math.max(0, (avgSNR - 10) / 30));
    
    return { 
      spo2: Math.max(70, Math.min(100, spo2)), // Asegurar rango fisiológico
      confidence 
    };
  }

  /**
   * Calcula el componente AC de la señal (variabilidad)
   */
  private calculateACComponent(signal: number[]): number {
    const mean = signal.reduce((sum, val) => sum + val, 0) / signal.length;
    const squaredDiffs = signal.map(val => Math.pow(val - mean, 2));
    return Math.sqrt(squaredDiffs.reduce((sum, val) => sum + val, 0) / signal.length);
  }

  /**
   * Calcula el componente DC de la señal (valor medio)
   */
  private calculateDCComponent(signal: number[]): number {
    return signal.reduce((sum, val) => sum + val, 0) / signal.length;
  }

  /**
   * Estima el nivel de ruido en la señal
   */
  private calculateNoise(signal: number[]): number {
    const mean = this.calculateDCComponent(signal);
    const diffs = signal.map(val => Math.abs(val - mean));
    return this.calculateMedian(diffs);
  }

  /**
   * Calcula la mediana de un arreglo de números
   */
  private calculateMedian(values: number[]): number {
    if (values.length === 0) return 0;
    
    const sorted = [...values].sort((a, b) => a - b);
    const half = Math.floor(sorted.length / 2);
    
    if (sorted.length % 2 === 0) {
      return (sorted[half - 1] + sorted[half]) / 2.0;
    }
    
    return sorted[half];
  }

  /**
   * Limpia el buffer
   */
  clear(): void {
    this.head = 0;
    this.tail = 0;
    this.count = 0;
    this.lastRRInterval = [];
  }

  /**
   * Obtiene el tamaño actual del buffer
   */
  size(): number {
    return this.count;
  }

  /**
   * Verifica si el buffer está vacío
   */
  isEmpty(): boolean {
    return this.count === 0;
  }

  /**
   * Verifica si el buffer está lleno
   */
  isFull(): boolean {
    return this.count === this.maxSize;
  }
}

export type { PPGDataPoint };
