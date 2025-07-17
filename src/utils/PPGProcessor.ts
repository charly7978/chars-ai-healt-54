import { CircularBuffer, PPGDataPoint } from './CircularBuffer';

/**
 * Procesador avanzado de señales PPG que implementa algoritmos de análisis de señal
 * para extraer métricas de salud cardiovascular.
 */
export class PPGProcessor {
  private buffer: CircularBuffer;
  private samplingRate: number;
  private lastProcessedTime: number = 0;
  private processingInterval: number = 100; // Procesar cada 100ms
  
  // Parámetros del algoritmo
  private readonly MIN_HEART_RATE = 40; // lpm
  private readonly MAX_HEART_RATE = 180; // lpm
  private readonly MIN_SPO2 = 70; // %
  private readonly MAX_SPO2 = 100; // %
  
  // Estado del procesamiento
  private currentHeartRate: number = 0;
  private currentSpO2: number = 0;
  private currentConfidence: number = 0;
  private currentArrhythmia: string = 'normal';
  
  /**
   * Crea una nueva instancia del procesador PPG
   * @param bufferSize Tamaño del buffer circular
   * @param samplingRate Frecuencia de muestreo en Hz
   */
  constructor(bufferSize: number = 1000, samplingRate: number = 30) {
    this.buffer = new CircularBuffer(bufferSize, samplingRate);
    this.samplingRate = samplingRate;
  }
  
  /**
   * Procesa un nuevo punto de datos PPG
   * @param point Punto de datos a procesar
   */
  processDataPoint(point: PPGDataPoint): void {
    const currentTime = Date.now();
    
    // Solo procesar si ha pasado el intervalo de procesamiento
    if (currentTime - this.lastProcessedTime >= this.processingInterval) {
      this.lastProcessedTime = currentTime;
      
      // Realizar análisis avanzado
      this.analyzeSignal();
    }
    
    // Agregar el punto al buffer
    this.buffer.push({
      ...point,
      time: currentTime // Asegurar que usamos la marca de tiempo actual
    });
  }
  
  /**
   * Realiza el análisis avanzado de la señal PPG
   */
  private analyzeSignal(): void {
    // 1. Análisis de la forma de onda
    this.analyzeWaveform();
    
    // 2. Análisis de variabilidad de frecuencia cardíaca (HRV)
    this.analyzeHRV();
    
    // 3. Detección de arritmias
    this.detectArrhythmias();
    
    // 4. Estimación de SpO2 (si hay datos de múltiples longitudes de onda)
    if (this.buffer.getLastValues(1)[0]?.rawRed && this.buffer.getLastValues(1)[0]?.rawIr) {
      this.estimateSpO2();
    }
  }
  
  /**
   * Analiza la forma de onda PPG para extraer características
   */
  private analyzeWaveform(): void {
    const points = this.buffer.getPoints();
    if (points.length < 10) return;
    
    // 1. Calcular características de la forma de onda
    const amplitudes = points.map(p => p.value);
    const maxAmplitude = Math.max(...amplitudes);
    const minAmplitude = Math.min(...amplitudes);
    const amplitude = maxAmplitude - minAmplitude;
    
    // 2. Calcular la frecuencia cardíaca basada en los picos
    const heartRate = this.calculateHeartRate();
    this.currentHeartRate = this.validateHeartRate(heartRate);
    
    // 3. Calcular la calidad de la señal
    this.currentConfidence = this.calculateSignalQuality(amplitude);
  }
  
  /**
   * Calcula la frecuencia cardíaca basada en los picos de la señal
   */
  private calculateHeartRate(): number {
    const points = this.buffer.getPoints();
    if (points.length < 2) return 0;
    
    // Detección de picos mejorada
    const peaks: number[] = [];
    const threshold = 0.5; // Umbral relativo
    const minPeakDistance = (60 / this.MAX_HEART_RATE) * 1000; // Distancia mínima entre picos en ms
    
    // Encontrar picos
    for (let i = 1; i < points.length - 1; i++) {
      if (points[i].value > points[i-1].value && 
          points[i].value > points[i+1].value &&
          points[i].value > threshold) {
        // Verificar distancia mínima con el pico anterior
        if (peaks.length === 0 || (points[i].time - points[peaks[peaks.length-1]].time) > minPeakDistance) {
          peaks.push(i);
        }
      }
    }
    
    // Calcular frecuencia cardíaca promedio
    if (peaks.length < 2) return 0;
    
    const intervals: number[] = [];
    for (let i = 1; i < peaks.length; i++) {
      const interval = points[peaks[i]].time - points[peaks[i-1]].time;
      intervals.push(interval);
    }
    
    // Filtrar valores atípicos
    const filteredIntervals = this.removeOutliers(intervals);
    if (filteredIntervals.length === 0) return 0;
    
    const avgInterval = filteredIntervals.reduce((a, b) => a + b, 0) / filteredIntervals.length;
    return (60 * 1000) / avgInterval; // Convertir a lpm
  }
  
  /**
   * Valida que la frecuencia cardíaca esté dentro de rangos fisiológicos
   */
  private validateHeartRate(hr: number): number {
    return Math.max(this.MIN_HEART_RATE, Math.min(this.MAX_HEART_RATE, hr));
  }
  
  /**
   * Calcula la calidad de la señal basada en la amplitud y la variabilidad
   */
  private calculateSignalQuality(amplitude: number): number {
    // Calcular relación señal/ruido (simplificado)
    const points = this.buffer.getPoints();
    if (points.length < 10) return 0;
    
    const values = points.map(p => p.value);
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const variance = values.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / values.length;
    const stdDev = Math.sqrt(variance);
    
    // SNR en dB
    const snr = 20 * Math.log10(amplitude / (stdDev || 0.001));
    
    // Mapear a un valor entre 0 y 1
    return Math.min(1, Math.max(0, (snr + 10) / 30));
  }
  
  /**
   * Analiza la variabilidad de la frecuencia cardíaca (HRV)
   */
  private analyzeHRV(): void {
    const points = this.buffer.getPoints();
    if (points.length < 100) return; // Necesitamos suficiente datos
    
    // Extraer intervalos RR
    const rri: number[] = [];
    let lastPeakTime = 0;
    
    for (let i = 1; i < points.length; i++) {
      if (points[i].value > 0.5 && points[i].value > points[i-1].value && 
          (i === points.length - 1 || points[i].value > points[i+1].value)) {
        if (lastPeakTime > 0) {
          rri.push(points[i].time - lastPeakTime);
        }
        lastPeakTime = points[i].time;
      }
    }
    
    if (rri.length < 5) return; // No hay suficientes intervalos
    
    // Calcular métricas de HRV en el dominio del tiempo
    const meanRR = rri.reduce((a, b) => a + b, 0) / rri.length;
    const diffs = [];
    
    for (let i = 1; i < rri.length; i++) {
      diffs.push(Math.abs(rri[i] - rri[i-1]));
    }
    
    const rmssd = Math.sqrt(diffs.reduce((a, b) => a + b * b, 0) / diffs.length);
    const pnn50 = (diffs.filter(d => d > 50).length / diffs.length) * 100;
    
    // Actualizar métricas (podrían usarse para detección de estrés, fatiga, etc.)
    // ...
  }
  
  /**
   * Detecta posibles arritmias cardíacas
   */
  private detectArrhythmias(): void {
    const points = this.buffer.getPoints();
    if (points.length < 100) return;
    
    // Detección de arritmias basada en la variabilidad de los intervalos RR
    const rri: number[] = [];
    let lastPeakTime = 0;
    
    for (let i = 1; i < points.length; i++) {
      if (points[i].value > 0.5 && points[i].value > points[i-1].value && 
          (i === points.length - 1 || points[i].value > points[i+1].value)) {
        if (lastPeakTime > 0) {
          rri.push(points[i].time - lastPeakTime);
        }
        lastPeakTime = points[i].time;
      }
    }
    
    if (rri.length < 5) return;
    
    // Calcular variabilidad
    const meanRR = rri.reduce((a, b) => a + b, 0) / rri.length;
    const sdnn = Math.sqrt(
      rri.reduce((a, b) => a + Math.pow(b - meanRR, 2), 0) / rri.length
    );
    
    // Detección de arritmias (ejemplo simplificado)
    if (sdnn > 50) {
      this.currentArrhythmia = 'possible_afib';
    } else {
      this.currentArrhythmia = 'normal';
    }
  }
  
  /**
   * Estima la saturación de oxígeno (SpO2) usando las señales roja e infrarroja
   */
  private estimateSpO2(): void {
    const points = this.buffer.getPoints();
    if (points.length < 10) return;
    
    // Obtener valores de las señales roja e infrarroja
    const redValues = points.map(p => p.rawRed || 0);
    const irValues = points.map(p => p.rawIr || 0);
    
    // Calcular componentes AC y DC
    const redAC = this.calculateACComponent(redValues);
    const redDC = this.calculateDCComponent(redValues);
    const irAC = this.calculateACComponent(irValues);
    const irDC = this.calculateDCComponent(irValues);
    
    // Calcular relación R
    const R = (redAC / redDC) / (irAC / irDC);
    
    // Fórmula de calibración (valores de ejemplo)
    const spo2 = 110 - 25 * R;
    
    // Validar rango
    this.currentSpO2 = Math.max(this.MIN_SPO2, Math.min(this.MAX_SPO2, spo2));
  }
  
  /**
   * Calcula el componente AC de una señal
   */
  private calculateACComponent(signal: number[]): number {
    if (signal.length === 0) return 0;
    
    // Aplicar filtro pasa altas (eliminar componente DC)
    const filtered = this.highPassFilter(signal, 0.5, this.samplingRate);
    
    // Calcular valor RMS del componente AC
    const squareSum = filtered.reduce((sum, val) => sum + val * val, 0);
    return Math.sqrt(squareSum / filtered.length);
  }
  
  /**
   * Calcula el componente DC de una señal
   */
  private calculateDCComponent(signal: number[]): number {
    if (signal.length === 0) return 0;
    return signal.reduce((sum, val) => sum + val, 0) / signal.length;
  }
  
  /**
   * Filtro paso alto
   */
  private highPassFilter(signal: number[], cutoffFreq: number, sampleRate: number): number[] {
    const RC = 1 / (2 * Math.PI * cutoffFreq);
    const dt = 1 / sampleRate;
    const alpha = RC / (RC + dt);
    
    const filtered = new Array(signal.length);
    filtered[0] = signal[0];
    
    for (let i = 1; i < signal.length; i++) {
      filtered[i] = alpha * (filtered[i-1] + signal[i] - signal[i-1]);
    }
    
    return filtered;
  }
  
  /**
   * Elimina valores atípicos de un conjunto de datos
   */
  private removeOutliers(data: number[], threshold: number = 1.5): number[] {
    if (data.length === 0) return [];
    
    // Calcular cuartiles
    const sorted = [...data].sort((a, b) => a - b);
    const q1 = this.calculatePercentile(sorted, 25);
    const q3 = this.calculatePercentile(sorted, 75);
    const iqr = q3 - q1;
    
    // Filtrar valores atípicos
    return data.filter(x => {
      return x >= (q1 - threshold * iqr) && x <= (q3 + threshold * iqr);
    });
  }
  
  /**
   * Calcula el percentil de un conjunto de datos ordenado
   */
  private calculatePercentile(sortedData: number[], percentile: number): number {
    const index = (percentile / 100) * (sortedData.length - 1);
    const lower = Math.floor(index);
    const fraction = index - lower;
    
    if (lower >= sortedData.length - 1) return sortedData[sortedData.length - 1];
    
    return sortedData[lower] + (sortedData[lower + 1] - sortedData[lower]) * fraction;
  }
  
  /**
   * Obtiene los resultados del procesamiento
   */
  getResults() {
    return {
      heartRate: Math.round(this.currentHeartRate),
      spo2: Math.round(this.currentSpO2 * 10) / 10,
      confidence: Math.round(this.currentConfidence * 100),
      arrhythmia: this.currentArrhythmia,
      timestamp: Date.now()
    };
  }
  
  /**
   * Reinicia el procesador
   */
  reset(): void {
    this.buffer.clear();
    this.currentHeartRate = 0;
    this.currentSpO2 = 0;
    this.currentConfidence = 0;
    this.currentArrhythmia = 'normal';
  }
}
