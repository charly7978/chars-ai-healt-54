
import { ImageData } from '../../types/image';

/**
 * Extractor PPG avanzado con técnicas de procesamiento de señal médico
 * Implementa algoritmos validados para extraer señales cardíacas reales
 */
export class AdvancedPPGExtractor {
  private signalHistory: number[] = [];
  private filteredHistory: number[] = [];
  private baseline: number = 0;
  private adaptiveGain: number = 1.0;
  private noiseEstimate: number = 0;
  
  // Parámetros de filtrado pasabanda para PPG (0.5-4 Hz)
  private readonly LOWPASS_ALPHA = 0.15;  // Filtro pasa bajos
  private readonly HIGHPASS_ALPHA = 0.85; // Filtro pasa altos
  private lowpassState: number = 0;
  private highpassState: number = 0;
  private highpassPrev: number = 0;
  
  // Buffer para análisis espectral básico
  private readonly ANALYSIS_WINDOW = 120; // 2 segundos a 60fps
  private readonly MIN_SIGNAL_AMPLITUDE = 0.5;
  
  constructor() {
    this.reset();
  }
  
  public reset(): void {
    this.signalHistory = [];
    this.filteredHistory = [];
    this.baseline = 0;
    this.adaptiveGain = 1.0;
    this.noiseEstimate = 0;
    this.lowpassState = 0;
    this.highpassState = 0;
    this.highpassPrev = 0;
  }
  
  /**
   * Extrae señal PPG mejorada del frame de la cámara
   */
  public extractPPGSignal(imageData: ImageData): {
    rawSignal: number;
    filteredSignal: number;
    quality: number;
    snr: number;
    fingerDetected: boolean;
  } {
    // 1. Extraer valores RGB de la región de interés
    const rgbValues = this.extractROIValues(imageData);
    
    // 2. Aplicar método CHROM para PPG robusto
    const chromSignal = this.applyCHROMMethod(rgbValues);
    
    // 3. Actualizar baseline adaptativo
    this.updateBaseline(chromSignal);
    
    // 4. Normalizar señal
    const normalizedSignal = chromSignal - this.baseline;
    
    // 5. Aplicar filtrado pasabanda (0.5-4 Hz)
    const filteredSignal = this.applyBandpassFilter(normalizedSignal);
    
    // 6. Amplificación adaptativa
    const amplifiedSignal = this.applyAdaptiveAmplification(filteredSignal);
    
    // 7. Actualizar historiales
    this.signalHistory.push(amplifiedSignal);
    this.filteredHistory.push(amplifiedSignal);
    
    if (this.signalHistory.length > this.ANALYSIS_WINDOW) {
      this.signalHistory.shift();
      this.filteredHistory.shift();
    }
    
    // 8. Calcular métricas de calidad
    const quality = this.calculateSignalQuality();
    const snr = this.calculateSNR();
    const fingerDetected = this.detectFingerPresence(rgbValues, quality);
    
    return {
      rawSignal: normalizedSignal,
      filteredSignal: amplifiedSignal,
      quality,
      snr,
      fingerDetected
    };
  }
  
  /**
   * Extrae valores RGB de región de interés optimizada
   */
  private extractROIValues(imageData: ImageData): { r: number; g: number; b: number } {
    const { data, width, height } = imageData;
    
    // ROI centrada más grande para mejor captura
    const roiSize = Math.min(width, height) * 0.6;
    const centerX = Math.floor(width / 2);
    const centerY = Math.floor(height / 2);
    const halfRoi = Math.floor(roiSize / 2);
    
    let rSum = 0, gSum = 0, bSum = 0;
    let pixelCount = 0;
    
    // Muestreo con patrón de grilla para mejor representatividad
    const sampleStep = 3; // Cada 3 píxeles
    
    for (let y = centerY - halfRoi; y < centerY + halfRoi; y += sampleStep) {
      for (let x = centerX - halfRoi; x < centerX + halfRoi; x += sampleStep) {
        if (x >= 0 && x < width && y >= 0 && y < height) {
          const pixelIndex = (y * width + x) * 4;
          rSum += data[pixelIndex];
          gSum += data[pixelIndex + 1];
          bSum += data[pixelIndex + 2];
          pixelCount++;
        }
      }
    }
    
    if (pixelCount === 0) return { r: 0, g: 0, b: 0 };
    
    return {
      r: rSum / pixelCount,
      g: gSum / pixelCount,
      b: bSum / pixelCount
    };
  }
  
  /**
   * Implementa método CHROM para extracción PPG robusta
   * Basado en De Haan & Jeanne (2013)
   */
  private applyCHROMMethod(rgb: { r: number; g: number; b: number }): number {
    const { r, g, b } = rgb;
    
    // Normalización para evitar división por cero
    const norm = Math.sqrt(r * r + g * g + b * b);
    if (norm < 1) return 0;
    
    const rNorm = r / norm;
    const gNorm = g / norm;
    const bNorm = b / norm;
    
    // Señal CHROM: 3*rNorm - 2*gNorm
    const chromSignal = 3 * rNorm - 2 * gNorm;
    
    // Componente adicional para mejorar la sensibilidad
    const greenComponent = gNorm - bNorm;
    
    // Combinar componentes con pesos optimizados
    return chromSignal * 0.7 + greenComponent * 0.3;
  }
  
  /**
   * Actualiza baseline adaptativo para seguir variaciones lentas
   */
  private updateBaseline(signal: number): void {
    if (this.baseline === 0) {
      this.baseline = signal;
    } else {
      // Adaptación muy lenta para baseline estable
      const adaptationRate = 0.001;
      this.baseline = this.baseline * (1 - adaptationRate) + signal * adaptationRate;
    }
  }
  
  /**
   * Aplica filtro pasabanda (0.5-4 Hz) para eliminar artefactos
   */
  private applyBandpassFilter(signal: number): number {
    // Filtro pasa bajos (elimina ruido de alta frecuencia)
    this.lowpassState = this.lowpassState + this.LOWPASS_ALPHA * (signal - this.lowpassState);
    
    // Filtro pasa altos (elimina deriva de línea base)
    const highpassInput = this.lowpassState;
    const highpassOutput = this.HIGHPASS_ALPHA * (this.highpassState + highpassInput - this.highpassPrev);
    this.highpassState = highpassOutput;
    this.highpassPrev = highpassInput;
    
    return highpassOutput;
  }
  
  /**
   * Amplificación adaptativa basada en la fuerza de la señal
   */
  private applyAdaptiveAmplification(signal: number): number {
    if (this.signalHistory.length < 30) {
      return signal * 2.0; // Amplificación inicial
    }
    
    // Calcular amplitud reciente
    const recentSignals = this.signalHistory.slice(-30);
    const amplitude = Math.max(...recentSignals) - Math.min(...recentSignals);
    
    // Ajustar ganancia adaptativa
    const targetAmplitude = 10.0;
    if (amplitude > 0.1) {
      this.adaptiveGain = Math.min(10.0, Math.max(0.5, targetAmplitude / amplitude));
    }
    
    return signal * this.adaptiveGain;
  }
  
  /**
   * Calcula calidad de señal basada en características PPG reales
   */
  private calculateSignalQuality(): number {
    if (this.filteredHistory.length < 60) return 0;
    
    const recentSignals = this.filteredHistory.slice(-60);
    
    // 1. Amplitud de señal (componente AC)
    const max = Math.max(...recentSignals);
    const min = Math.min(...recentSignals);
    const amplitude = max - min;
    const amplitudeScore = Math.min(100, amplitude * 5);
    
    // 2. Estabilidad (baja varianza del ruido)
    const mean = recentSignals.reduce((a, b) => a + b, 0) / recentSignals.length;
    const variance = recentSignals.reduce((a, b) => a + (b - mean) ** 2, 0) / recentSignals.length;
    const stabilityScore = Math.max(0, 100 - variance * 2);
    
    // 3. Pulsatilidad (detección de picos regulares)
    const pulsatilityScore = this.calculatePulsatilityScore(recentSignals);
    
    // 4. SNR
    const snr = this.calculateSNR();
    const snrScore = Math.min(100, Math.max(0, (snr - 5) * 10));
    
    // Combinación ponderada
    return Math.round(
      amplitudeScore * 0.3 +
      stabilityScore * 0.2 +
      pulsatilityScore * 0.3 +
      snrScore * 0.2
    );
  }
  
  /**
   * Calcula score de pulsatilidad detectando patrones cardíacos
   */
  private calculatePulsatilityScore(signals: number[]): number {
    if (signals.length < 20) return 0;
    
    let peakCount = 0;
    let valleyCount = 0;
    
    // Detectar picos y valles
    for (let i = 2; i < signals.length - 2; i++) {
      const current = signals[i];
      const neighbors = [signals[i-2], signals[i-1], signals[i+1], signals[i+2]];
      const avgNeighbors = neighbors.reduce((a, b) => a + b, 0) / neighbors.length;
      
      if (current > avgNeighbors + 1.0) peakCount++;
      if (current < avgNeighbors - 1.0) valleyCount++;
    }
    
    // Pulsatilidad óptima: 1-3 picos por ventana de 1 segundo
    const expectedPeaks = 2;
    const peakRatio = Math.min(peakCount, valleyCount) / expectedPeaks;
    
    return Math.min(100, peakRatio * 100);
  }
  
  /**
   * Calcula SNR (Signal-to-Noise Ratio)
   */
  private calculateSNR(): number {
    if (this.filteredHistory.length < 60) return 0;
    
    const recentSignals = this.filteredHistory.slice(-60);
    const mean = recentSignals.reduce((a, b) => a + b, 0) / recentSignals.length;
    
    // Potencia de señal (varianza)
    const signalPower = recentSignals.reduce((a, b) => a + (b - mean) ** 2, 0) / recentSignals.length;
    
    // Estimación de ruido basada en diferencias de alto orden
    let noisePower = 0;
    for (let i = 1; i < recentSignals.length; i++) {
      const diff = recentSignals[i] - recentSignals[i-1];
      noisePower += diff * diff;
    }
    noisePower /= (recentSignals.length - 1);
    
    if (noisePower < 0.001) noisePower = 0.001; // Evitar división por cero
    
    return 10 * Math.log10(signalPower / noisePower);
  }
  
  /**
   * Detecta presencia real del dedo basada en características de piel
   */
  private detectFingerPresence(rgb: { r: number; g: number; b: number }, quality: number): boolean {
    const { r, g, b } = rgb;
    
    // Criterios básicos para piel humana
    const hasMinIntensity = r > 30 && g > 20 && b > 15;
    const isRedDominant = r > g && r > b;
    const hasReasonableRatio = (r / (g + 1)) > 1.1 && (r / (g + 1)) < 3.0;
    const notSaturated = r < 250 && g < 250 && b < 250;
    
    // Verificar que hay señal PPG mínima
    const hasSignal = quality > 5 && this.filteredHistory.length > 10;
    
    return hasMinIntensity && isRedDominant && hasReasonableRatio && notSaturated && hasSignal;
  }
}
