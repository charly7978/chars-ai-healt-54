
import { ImageData } from '../../types/image';

/**
 * Extractor PPG SELECTIVO - Solo señales pulsátiles reales de dedo
 * NO objetos sólidos ni superficies estáticas
 */
export class AdvancedPPGExtractor {
  private signalHistory: number[] = [];
  private filteredHistory: number[] = [];
  private baseline: number = 0;
  private adaptiveGain: number = 1.5;
  private noiseEstimate: number = 0;
  
  // Buffer para detectar PULSATILIDAD REAL
  private pulsatilityBuffer: number[] = [];
  private movementBuffer: number[] = [];
  
  // Filtros optimizados para PPG real
  private readonly LOWPASS_ALPHA = 0.15;
  private readonly HIGHPASS_ALPHA = 0.85;
  private lowpassState: number = 0;
  private highpassState: number = 0;
  private highpassPrev: number = 0;
  
  private readonly ANALYSIS_WINDOW = 60;
  private readonly PULSATILITY_WINDOW = 40;
  
  constructor() {
    this.reset();
  }
  
  public reset(): void {
    this.signalHistory = [];
    this.filteredHistory = [];
    this.pulsatilityBuffer = [];
    this.movementBuffer = [];
    this.baseline = 0;
    this.adaptiveGain = 1.5;
    this.noiseEstimate = 0;
    this.lowpassState = 0;
    this.highpassState = 0;
    this.highpassPrev = 0;
  }
  
  public extractPPGSignal(imageData: ImageData): {
    rawSignal: number;
    filteredSignal: number;
    quality: number;
    snr: number;
    fingerDetected: boolean;
  } {
    // 1. Extraer RGB de ROI centrada
    const rgbValues = this.extractCenteredROI(imageData);
    
    // 2. Aplicar CHROM para señal PPG
    const chromSignal = this.applySelectiveCHROM(rgbValues);
    
    // 3. Baseline adaptativo lento
    this.updateSlowBaseline(chromSignal);
    
    // 4. Normalización
    const normalizedSignal = chromSignal - this.baseline;
    
    // 5. Filtrado PPG específico
    const filteredSignal = this.applyPPGFilter(normalizedSignal);
    
    // 6. Amplificación controlada
    const amplifiedSignal = this.applyControlledAmplification(filteredSignal);
    
    // 7. Actualizar historiales
    this.signalHistory.push(amplifiedSignal);
    this.filteredHistory.push(amplifiedSignal);
    this.pulsatilityBuffer.push(amplifiedSignal);
    this.movementBuffer.push(Math.abs(amplifiedSignal - (this.signalHistory[this.signalHistory.length - 2] || 0)));
    
    if (this.signalHistory.length > this.ANALYSIS_WINDOW) {
      this.signalHistory.shift();
      this.filteredHistory.shift();
    }
    
    if (this.pulsatilityBuffer.length > this.PULSATILITY_WINDOW) {
      this.pulsatilityBuffer.shift();
    }
    
    if (this.movementBuffer.length > 20) {
      this.movementBuffer.shift();
    }
    
    // 8. Análisis SELECTIVO de señal
    const quality = this.calculateSelectiveQuality();
    const snr = this.calculatePPGSNR();
    const fingerDetected = this.detectRealPPGSignal(rgbValues, quality, amplifiedSignal);
    
    return {
      rawSignal: normalizedSignal,
      filteredSignal: amplifiedSignal,
      quality,
      snr,
      fingerDetected
    };
  }
  
  /**
   * ROI centrada y estable
   */
  private extractCenteredROI(imageData: ImageData): { r: number; g: number; b: number } {
    const { data, width, height } = imageData;
    
    // ROI pequeña y centrada
    const roiSize = Math.min(width, height) * 0.4;
    const centerX = Math.floor(width / 2);
    const centerY = Math.floor(height / 2);
    const halfRoi = Math.floor(roiSize / 2);
    
    let rSum = 0, gSum = 0, bSum = 0;
    let pixelCount = 0;
    
    // Muestreo regular
    const sampleStep = 3;
    
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
    
    if (pixelCount === 0) return { r: 128, g: 128, b: 128 };
    
    return {
      r: rSum / pixelCount,
      g: gSum / pixelCount,
      b: bSum / pixelCount
    };
  }
  
  /**
   * CHROM selectivo para PPG
   */
  private applySelectiveCHROM(rgb: { r: number; g: number; b: number }): number {
    const { r, g, b } = rgb;
    
    const total = r + g + b;
    if (total < 100) return 0;
    
    const rNorm = r / total;
    const gNorm = g / total;
    const bNorm = b / total;
    
    // CHROM clásico optimizado
    const chromX = 3 * rNorm - 2 * gNorm;
    const chromY = 1.5 * rNorm - gNorm - 0.5 * bNorm;
    
    return chromX * 0.7 + chromY * 0.3;
  }
  
  /**
   * Baseline lento y estable
   */
  private updateSlowBaseline(signal: number): void {
    if (this.baseline === 0) {
      this.baseline = signal;
    } else {
      // Adaptación muy lenta para estabilidad
      const adaptationRate = 0.001;
      this.baseline = this.baseline * (1 - adaptationRate) + signal * adaptationRate;
    }
  }
  
  /**
   * Filtrado específico para PPG
   */
  private applyPPGFilter(signal: number): number {
    // Filtro pasa bajos
    this.lowpassState = this.lowpassState + this.LOWPASS_ALPHA * (signal - this.lowpassState);
    
    // Filtro pasa altos
    const highpassInput = this.lowpassState;
    const highpassOutput = this.HIGHPASS_ALPHA * (this.highpassState + highpassInput - this.highpassPrev);
    this.highpassState = highpassOutput;
    this.highpassPrev = highpassInput;
    
    return highpassOutput;
  }
  
  /**
   * Amplificación controlada
   */
  private applyControlledAmplification(signal: number): number {
    if (this.signalHistory.length < 30) {
      return signal * 2.0;
    }
    
    const recentSignals = this.signalHistory.slice(-30);
    const amplitude = Math.max(...recentSignals) - Math.min(...recentSignals);
    
    const targetAmplitude = 8.0;
    if (amplitude > 0.1) {
      this.adaptiveGain = Math.min(5.0, Math.max(0.5, targetAmplitude / amplitude));
    }
    
    return signal * this.adaptiveGain;
  }
  
  /**
   * Calidad SELECTIVA - Solo señales PPG reales
   */
  private calculateSelectiveQuality(): number {
    if (this.filteredHistory.length < 40) return 5; // Muy baja al inicio
    
    const recentSignals = this.filteredHistory.slice(-40);
    
    // 1. Pulsatilidad REAL - Lo más importante
    const pulsatilityScore = this.calculateRealPulsatility(recentSignals);
    if (pulsatilityScore < 20) return 5; // Si no es pulsátil, calidad muy baja
    
    // 2. Amplitud mínima requerida
    const max = Math.max(...recentSignals);
    const min = Math.min(...recentSignals);
    const amplitude = max - min;
    const amplitudeScore = Math.min(100, amplitude * 8);
    
    // 3. Estabilidad de la señal
    const mean = recentSignals.reduce((a, b) => a + b, 0) / recentSignals.length;
    const variance = recentSignals.reduce((a, b) => a + (b - mean) ** 2, 0) / recentSignals.length;
    const stabilityScore = Math.max(0, 100 - variance * 2);
    
    // 4. SNR
    const snr = this.calculatePPGSNR();
    const snrScore = Math.min(100, Math.max(0, (snr - 5) * 10));
    
    // 5. Detección de movimiento excesivo
    const movementPenalty = this.calculateMovementPenalty();
    
    // Combinación con peso ALTO en pulsatilidad
    const finalQuality = Math.round(
      pulsatilityScore * 0.5 +
      amplitudeScore * 0.2 +
      stabilityScore * 0.15 +
      snrScore * 0.15
    ) - movementPenalty;
    
    return Math.max(5, Math.min(100, finalQuality));
  }
  
  /**
   * Pulsatilidad REAL - Detecta patrones cardíacos
   */
  private calculateRealPulsatility(signals: number[]): number {
    if (signals.length < 20) return 0;
    
    // Buscar patrones rítmicos reales
    let peakCount = 0;
    let valleyCount = 0;
    let rhythmScore = 0;
    
    // Detectar picos y valles con umbral adaptativo
    const mean = signals.reduce((a, b) => a + b, 0) / signals.length;
    const std = Math.sqrt(signals.reduce((a, b) => a + (b - mean) ** 2, 0) / signals.length);
    const threshold = std * 0.5;
    
    for (let i = 2; i < signals.length - 2; i++) {
      const current = signals[i];
      const prev = signals[i-1];
      const next = signals[i+1];
      const prev2 = signals[i-2];
      const next2 = signals[i+2];
      
      // Pico: mayor que vecinos con margen
      if (current > prev && current > next && 
          current > prev2 && current > next2 && 
          current > mean + threshold) {
        peakCount++;
      }
      
      // Valle: menor que vecinos con margen
      if (current < prev && current < next && 
          current < prev2 && current < next2 && 
          current < mean - threshold) {
        valleyCount++;
      }
    }
    
    // Verificar ritmo cardíaco plausible (0.5-3 Hz)
    const totalVariations = peakCount + valleyCount;
    const expectedVariations = signals.length / 10; // Aprox para FC normal
    
    if (totalVariations >= expectedVariations * 0.3 && totalVariations <= expectedVariations * 3) {
      rhythmScore = 100;
    } else {
      rhythmScore = Math.max(0, 50 - Math.abs(totalVariations - expectedVariations) * 5);
    }
    
    return Math.min(100, rhythmScore);
  }
  
  /**
   * SNR específico para PPG
   */
  private calculatePPGSNR(): number {
    if (this.filteredHistory.length < 30) return 3;
    
    const recentSignals = this.filteredHistory.slice(-30);
    const mean = recentSignals.reduce((a, b) => a + b, 0) / recentSignals.length;
    
    // Potencia de señal pulsátil
    const signalPower = recentSignals.reduce((a, b) => a + (b - mean) ** 2, 0) / recentSignals.length;
    
    // Estimación de ruido por diferencias de alta frecuencia
    let noisePower = 0;
    for (let i = 1; i < recentSignals.length; i++) {
      const diff = recentSignals[i] - recentSignals[i-1];
      noisePower += diff * diff;
    }
    noisePower /= (recentSignals.length - 1);
    noisePower = Math.max(noisePower, 0.001);
    
    const snr = 10 * Math.log10(signalPower / noisePower);
    return Math.max(0, Math.min(30, snr));
  }
  
  /**
   * Penalización por movimiento excesivo
   */
  private calculateMovementPenalty(): number {
    if (this.movementBuffer.length < 10) return 0;
    
    const recentMovement = this.movementBuffer.slice(-10);
    const avgMovement = recentMovement.reduce((a, b) => a + b, 0) / recentMovement.length;
    
    // Penalizar movimiento excesivo
    if (avgMovement > 2.0) {
      return Math.min(30, (avgMovement - 2.0) * 10);
    }
    
    return 0;
  }
  
  /**
   * Detección SELECTIVA de señal PPG real
   */
  private detectRealPPGSignal(rgb: { r: number; g: number; b: number }, quality: number, signal: number): boolean {
    const { r, g, b } = rgb;
    
    // 1. Verificaciones básicas de piel
    const hasMinIntensity = r > 40 && g > 25 && b > 15;
    const isRedDominant = r > g * 1.1 && r > b * 1.2;
    const hasReasonableRatio = (r / (g + 1)) > 1.1 && (r / (g + 1)) < 2.5;
    const notSaturated = r < 240 && g < 240 && b < 240;
    
    // 2. Verificación de señal PPG mínima
    const hasSignal = quality > 25 && Math.abs(signal) > 1.0;
    
    // 3. Verificación de pulsatilidad REAL
    const hasPulsatility = this.pulsatilityBuffer.length >= 20 && 
                          this.calculateRealPulsatility(this.pulsatilityBuffer.slice(-20)) > 30;
    
    // 4. Verificación de intensidad total
    const totalIntensity = r + g + b;
    const hasGoodIntensity = totalIntensity > 120 && totalIntensity < 600;
    
    // 5. Verificación de movimiento controlado
    const hasControlledMovement = this.movementBuffer.length < 10 || 
                                 (this.movementBuffer.slice(-10).reduce((a, b) => a + b, 0) / 10) < 3.0;
    
    // TODAS las condiciones deben cumplirse para detección válida
    return hasMinIntensity && 
           isRedDominant && 
           hasReasonableRatio && 
           notSaturated && 
           hasSignal && 
           hasPulsatility && 
           hasGoodIntensity && 
           hasControlledMovement;
  }
}
