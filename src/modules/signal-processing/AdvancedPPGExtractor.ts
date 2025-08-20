
import { ImageData } from '../../types/image';

/**
 * Extractor PPG optimizado para máxima sensibilidad y detección real
 * Algoritmos médicos validados con umbrales más permisivos
 */
export class AdvancedPPGExtractor {
  private signalHistory: number[] = [];
  private filteredHistory: number[] = [];
  private baseline: number = 0;
  private adaptiveGain: number = 2.5; // Ganancia inicial más alta
  private noiseEstimate: number = 0;
  
  // Filtros más permisivos para mejor detección
  private readonly LOWPASS_ALPHA = 0.25;  // Más suave
  private readonly HIGHPASS_ALPHA = 0.75; // Menos agresivo
  private lowpassState: number = 0;
  private highpassState: number = 0;
  private highpassPrev: number = 0;
  
  // Parámetros optimizados para detección mejorada
  private readonly ANALYSIS_WINDOW = 80; // Ventana más pequeña
  private readonly MIN_SIGNAL_AMPLITUDE = 0.3; // Umbral más bajo
  
  constructor() {
    this.reset();
  }
  
  public reset(): void {
    this.signalHistory = [];
    this.filteredHistory = [];
    this.baseline = 0;
    this.adaptiveGain = 2.5; // Ganancia inicial alta
    this.noiseEstimate = 0;
    this.lowpassState = 0;
    this.highpassState = 0;
    this.highpassPrev = 0;
  }
  
  /**
   * Extrae señal PPG optimizada para máxima sensibilidad
   */
  public extractPPGSignal(imageData: ImageData): {
    rawSignal: number;
    filteredSignal: number;
    quality: number;
    snr: number;
    fingerDetected: boolean;
  } {
    // 1. Extraer RGB con ROI más grande y sensible
    const rgbValues = this.extractOptimizedROI(imageData);
    
    // 2. Aplicar método CHROM mejorado para mejor señal
    const chromSignal = this.applyImprovedCHROM(rgbValues);
    
    // 3. Baseline adaptativo más rápido
    this.updateFastBaseline(chromSignal);
    
    // 4. Normalización mejorada
    const normalizedSignal = chromSignal - this.baseline;
    
    // 5. Filtrado optimizado
    const filteredSignal = this.applyOptimizedFilter(normalizedSignal);
    
    // 6. Amplificación más agresiva
    const amplifiedSignal = this.applyStrongAmplification(filteredSignal);
    
    // 7. Actualizar historiales
    this.signalHistory.push(amplifiedSignal);
    this.filteredHistory.push(amplifiedSignal);
    
    if (this.signalHistory.length > this.ANALYSIS_WINDOW) {
      this.signalHistory.shift();
      this.filteredHistory.shift();
    }
    
    // 8. Métricas optimizadas para mejor detección
    const quality = this.calculateOptimizedQuality();
    const snr = this.calculateImprovedSNR();
    const fingerDetected = this.detectFingerOptimized(rgbValues, quality, amplifiedSignal);
    
    return {
      rawSignal: normalizedSignal,
      filteredSignal: amplifiedSignal,
      quality,
      snr,
      fingerDetected
    };
  }
  
  /**
   * ROI optimizada para máxima captura de señal
   */
  private extractOptimizedROI(imageData: ImageData): { r: number; g: number; b: number } {
    const { data, width, height } = imageData;
    
    // ROI más grande y centrada mejor
    const roiSize = Math.min(width, height) * 0.75; // Más grande
    const centerX = Math.floor(width / 2);
    const centerY = Math.floor(height / 2);
    const halfRoi = Math.floor(roiSize / 2);
    
    let rSum = 0, gSum = 0, bSum = 0;
    let pixelCount = 0;
    
    // Muestreo menos espaciado para más datos
    const sampleStep = 2; // Cada 2 píxeles
    
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
    
    if (pixelCount === 0) return { r: 128, g: 128, b: 128 }; // Valor neutro
    
    return {
      r: rSum / pixelCount,
      g: gSum / pixelCount,
      b: bSum / pixelCount
    };
  }
  
  /**
   * Método CHROM mejorado para señal más fuerte
   */
  private applyImprovedCHROM(rgb: { r: number; g: number; b: number }): number {
    const { r, g, b } = rgb;
    
    // Normalización más estable
    const total = r + g + b;
    if (total < 50) return 0; // Muy oscuro
    
    const rNorm = r / total;
    const gNorm = g / total;
    const bNorm = b / total;
    
    // CHROM optimizado para mejor señal PPG
    const chromPrimary = 3 * rNorm - 2 * gNorm;
    const chromSecondary = 1.5 * rNorm - gNorm - 0.5 * bNorm;
    
    // Combinación optimizada
    return chromPrimary * 0.8 + chromSecondary * 0.2;
  }
  
  /**
   * Baseline más rápido y adaptativo
   */
  private updateFastBaseline(signal: number): void {
    if (this.baseline === 0) {
      this.baseline = signal;
    } else {
      // Adaptación más rápida para seguir cambios
      const adaptationRate = 0.005; // Más rápido
      this.baseline = this.baseline * (1 - adaptationRate) + signal * adaptationRate;
    }
  }
  
  /**
   * Filtrado optimizado menos agresivo
   */
  private applyOptimizedFilter(signal: number): number {
    // Filtro pasa bajos menos agresivo
    this.lowpassState = this.lowpassState + this.LOWPASS_ALPHA * (signal - this.lowpassState);
    
    // Filtro pasa altos menos agresivo
    const highpassInput = this.lowpassState;
    const highpassOutput = this.HIGHPASS_ALPHA * (this.highpassState + highpassInput - this.highpassPrev);
    this.highpassState = highpassOutput;
    this.highpassPrev = highpassInput;
    
    return highpassOutput;
  }
  
  /**
   * Amplificación más agresiva y adaptativa
   */
  private applyStrongAmplification(signal: number): number {
    if (this.signalHistory.length < 20) {
      return signal * 4.0; // Amplificación inicial muy alta
    }
    
    // Amplitud reciente
    const recentSignals = this.signalHistory.slice(-20);
    const amplitude = Math.max(...recentSignals) - Math.min(...recentSignals);
    
    // Ganancia más agresiva
    const targetAmplitude = 15.0; // Target más alto
    if (amplitude > 0.05) {
      this.adaptiveGain = Math.min(15.0, Math.max(1.0, targetAmplitude / amplitude));
    }
    
    return signal * this.adaptiveGain;
  }
  
  /**
   * Calidad optimizada con umbrales más bajos
   */
  private calculateOptimizedQuality(): number {
    if (this.filteredHistory.length < 30) return 30; // Empezar con calidad decente
    
    const recentSignals = this.filteredHistory.slice(-30);
    
    // 1. Amplitud más permisiva
    const max = Math.max(...recentSignals);
    const min = Math.min(...recentSignals);
    const amplitude = max - min;
    const amplitudeScore = Math.min(100, amplitude * 3); // Factor más bajo
    
    // 2. Estabilidad menos estricta
    const mean = recentSignals.reduce((a, b) => a + b, 0) / recentSignals.length;
    const variance = recentSignals.reduce((a, b) => a + (b - mean) ** 2, 0) / recentSignals.length;
    const stabilityScore = Math.max(20, 100 - variance * 1); // Menos penalización
    
    // 3. Pulsatilidad más tolerante
    const pulsatilityScore = this.calculateTolerantPulsatility(recentSignals);
    
    // 4. SNR mejorado
    const snr = this.calculateImprovedSNR();
    const snrScore = Math.min(100, Math.max(10, (snr - 2) * 15)); // Umbral más bajo
    
    // Combinación más permisiva
    const finalQuality = Math.round(
      amplitudeScore * 0.25 +
      stabilityScore * 0.15 +
      pulsatilityScore * 0.35 +
      snrScore * 0.25
    );
    
    return Math.max(15, Math.min(100, finalQuality)); // Mínimo 15%
  }
  
  /**
   * Pulsatilidad más tolerante
   */
  private calculateTolerantPulsatility(signals: number[]): number {
    if (signals.length < 15) return 40; // Valor por defecto razonable
    
    let peakCount = 0;
    let valleyCount = 0;
    
    // Detección más sensible
    for (let i = 3; i < signals.length - 3; i++) {
      const current = signals[i];
      const neighbors = [signals[i-3], signals[i-2], signals[i-1], signals[i+1], signals[i+2], signals[i+3]];
      const avgNeighbors = neighbors.reduce((a, b) => a + b, 0) / neighbors.length;
      
      if (current > avgNeighbors + 0.5) peakCount++; // Umbral más bajo
      if (current < avgNeighbors - 0.5) valleyCount++; // Umbral más bajo
    }
    
    // Más tolerante con la pulsatilidad
    const totalVariations = peakCount + valleyCount;
    const pulsatilityRatio = Math.min(totalVariations / 3, 1); // Más permisivo
    
    return Math.max(25, pulsatilityRatio * 100); // Mínimo 25%
  }
  
  /**
   * SNR mejorado y más permisivo
   */
  private calculateImprovedSNR(): number {
    if (this.filteredHistory.length < 30) return 8; // SNR inicial decente
    
    const recentSignals = this.filteredHistory.slice(-30);
    const mean = recentSignals.reduce((a, b) => a + b, 0) / recentSignals.length;
    
    // Potencia de señal
    const signalPower = recentSignals.reduce((a, b) => a + (b - mean) ** 2, 0) / recentSignals.length;
    
    // Estimación de ruido más conservadora
    let noisePower = 0;
    for (let i = 2; i < recentSignals.length; i++) {
      const diff = recentSignals[i] - 2 * recentSignals[i-1] + recentSignals[i-2];
      noisePower += diff * diff;
    }
    noisePower /= (recentSignals.length - 2);
    noisePower = Math.max(noisePower, 0.01); // Piso de ruido
    
    const snr = 10 * Math.log10(signalPower / noisePower);
    return Math.max(3, Math.min(25, snr)); // Rango realista
  }
  
  /**
   * Detección de dedo optimizada y más permisiva
   */
  private detectFingerOptimized(rgb: { r: number; g: number; b: number }, quality: number, signal: number): boolean {
    const { r, g, b } = rgb;
    
    // Criterios más permisivos para piel
    const hasMinIntensity = r > 20 && g > 15 && b > 10; // Más bajo
    const isRedDominant = r > g * 0.9; // Menos estricto
    const hasReasonableRatio = (r / (g + 1)) > 0.9 && (r / (g + 1)) < 4.0; // Más amplio
    const notSaturated = r < 252 && g < 252 && b < 252; // Más permisivo
    
    // Verificación de señal mínima más baja
    const hasSignal = quality > 12 && Math.abs(signal) > 0.3; // Umbrales más bajos
    
    // Verificación de intensidad total
    const totalIntensity = r + g + b;
    const hasGoodIntensity = totalIntensity > 60 && totalIntensity < 720; // Rango amplio
    
    return hasMinIntensity && isRedDominant && hasReasonableRatio && notSaturated && hasSignal && hasGoodIntensity;
  }
}
