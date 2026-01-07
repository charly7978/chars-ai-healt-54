import { FrameData } from './types';
import { ProcessedSignal } from '../../types/signal';

/**
 * FrameProcessor - EXTRACCIÓN PPG ROBUSTA BASADA EN LITERATURA CIENTÍFICA
 * 
 * MEJORES PRÁCTICAS APLICADAS (PMC9136485, Sensors 2017):
 * 1. Full-frame averaging con detección de piel adaptativa
 * 2. Fórmula de detección de piel: nr/ng > 1.185 (VideoAudit)
 * 3. Suavizado temporal moderado para preservar pulsatilidad
 * 4. Sin step de muestreo - usar TODOS los píxeles para máxima robustez
 * 5. Usar canal VERDE para mejor señal PPG en reflectancia (Matsumura 2020)
 */
export class FrameProcessor {
  // Buffer para análisis temporal - 240 frames para 4s @ 60fps
  private redBuffer: number[] = [];
  private greenBuffer: number[] = [];
  private blueBuffer: number[] = [];
  private readonly BUFFER_SIZE = 240;
  
  // === CALIBRACIÓN ADAPTATIVA ===
  private calibrationDC: number = 0;
  private calibrationComplete: boolean = false;
  private calibrationSamples: number = 0;
  private readonly CALIBRATION_FRAMES = 30; // 0.5s @ 60fps
  
  // Control automático de ganancia
  private gainFactor: number = 1.0;
  private readonly TARGET_DC = 140;
  private readonly MIN_GAIN = 0.5;
  private readonly MAX_GAIN = 2.0;
  
  // Suavizado temporal REDUCIDO para preservar pulsatilidad
  // Según literatura: demasiado suavizado elimina la señal de pulso
  private lastRed: number = 0;
  private lastGreen: number = 0;
  private lastBlue: number = 0;
  private readonly SMOOTHING = 0.3; // 30% anterior, 70% nuevo - MÁS REACTIVO
  
  // Log
  private frameCount = 0;
  private readonly LOG_EVERY = 120; // cada 2s @ 60fps
  
  // Estadísticas
  private skinPixelRatio: number = 0;
  private lastSkinCount: number = 0;
  
  constructor(config?: { TEXTURE_GRID_SIZE?: number, ROI_SIZE_FACTOR?: number }) {}
  
  /**
   * EXTRACCIÓN FULL-FRAME OPTIMIZADA
   * 
   * Basado en literatura científica:
   * - Promediar TODOS los píxeles de piel detectados
   * - Usar fórmula de detección de piel robusta
   * - NO usar step de muestreo para máxima cobertura
   */
  extractFrameData(imageData: ImageData): FrameData {
    const data = imageData.data;
    const width = imageData.width;
    const height = imageData.height;
    const totalPixels = width * height;
    
    let redSum = 0;
    let greenSum = 0;
    let blueSum = 0;
    let skinPixelCount = 0;
    
    // PROCESAR TODOS LOS PÍXELES - Sin step para máxima robustez
    // En 720p (921,600 píxeles) esto es ~3.6MB pero JavaScript moderno lo maneja
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      
      // DETECCIÓN DE PIEL CIENTÍFICA
      // Basado en: nr/ng > 1.185 AND r*b/(r+g+b)² > 0.107 AND r*g/(r+g+b)² > 0.112
      // Simplificado para velocidad pero manteniendo robustez
      const total = r + g + b;
      if (total < 50) continue; // Muy oscuro
      
      const nr = r / total;
      const ng = g / total;
      
      // Criterio simplificado pero robusto:
      // 1. Rojo normalizado > 0.33 (debe ser al menos 1/3)
      // 2. nr/ng > 1.0 (rojo domina sobre verde - típico de piel con flash)
      // 3. Luminancia mínima para evitar ruido
      const nrng = ng > 0.01 ? nr / ng : 0;
      
      if (nr > 0.33 && nrng > 1.0 && r > 40) {
        redSum += r;
        greenSum += g;
        blueSum += b;
        skinPixelCount++;
      }
    }
    
    // Calcular ratio de cobertura
    this.skinPixelRatio = skinPixelCount / totalPixels;
    this.lastSkinCount = skinPixelCount;
    
    // Si hay muy pocos píxeles de piel (<5% del frame), usar todo el frame
    // Esto previene fallos cuando el dedo cubre parcialmente
    if (skinPixelCount < totalPixels * 0.05) {
      redSum = 0; greenSum = 0; blueSum = 0; skinPixelCount = 0;
      
      // Fallback: promediar todo con step para velocidad
      for (let i = 0; i < data.length; i += 16) { // step de 4 píxeles
        redSum += data[i];
        greenSum += data[i + 1];
        blueSum += data[i + 2];
        skinPixelCount++;
      }
    }
    
    // Calcular promedios
    const rawRed = skinPixelCount > 0 ? redSum / skinPixelCount : 0;
    const rawGreen = skinPixelCount > 0 ? greenSum / skinPixelCount : 0;
    const rawBlue = skinPixelCount > 0 ? blueSum / skinPixelCount : 0;
    
    // === SUAVIZADO TEMPORAL MODERADO ===
    // Importante: No suavizar demasiado o se pierde la pulsatilidad
    let smoothedRed: number, smoothedGreen: number, smoothedBlue: number;
    
    if (this.lastRed === 0) {
      // Primera muestra - sin suavizado
      smoothedRed = rawRed;
      smoothedGreen = rawGreen;
      smoothedBlue = rawBlue;
    } else {
      // Suavizado ligero: 30% anterior + 70% nuevo
      smoothedRed = this.lastRed * this.SMOOTHING + rawRed * (1 - this.SMOOTHING);
      smoothedGreen = this.lastGreen * this.SMOOTHING + rawGreen * (1 - this.SMOOTHING);
      smoothedBlue = this.lastBlue * this.SMOOTHING + rawBlue * (1 - this.SMOOTHING);
    }
    
    this.lastRed = smoothedRed;
    this.lastGreen = smoothedGreen;
    this.lastBlue = smoothedBlue;
    
    // === CALIBRACIÓN DE GANANCIA ===
    this.updateGainCalibration(smoothedRed, smoothedGreen, smoothedBlue);
    
    // Aplicar ganancia
    const avgRed = this.applyAdaptiveNormalization(smoothedRed);
    const avgGreen = this.applyAdaptiveNormalization(smoothedGreen);
    const avgBlue = this.applyAdaptiveNormalization(smoothedBlue);
    
    // Log de diagnóstico
    this.frameCount++;
    if (this.frameCount % this.LOG_EVERY === 0) {
      const rgRatio = avgGreen > 0 ? (avgRed / avgGreen).toFixed(2) : 'N/A';
      const skinPct = (this.skinPixelRatio * 100).toFixed(1);
      const skinK = (this.lastSkinCount / 1000).toFixed(0);
      console.log(`🖐️ PPG: R=${avgRed.toFixed(0)} G=${avgGreen.toFixed(0)} | R/G=${rgRatio} | Skin=${skinPct}% (${skinK}K px)`);
    }
    
    // Actualizar buffers
    this.updateBuffers(avgRed, avgGreen, avgBlue);
    
    // Calcular ratios
    const rToGRatio = avgGreen > 0 ? avgRed / avgGreen : 1;
    const rToBRatio = avgBlue > 0 ? avgRed / avgBlue : 1;
    
    // Calcular AC
    const acComponent = this.calculateACComponent();
    
    return {
      redValue: avgRed,
      avgRed,
      avgGreen,
      avgBlue,
      textureScore: acComponent,
      rToGRatio,
      rToBRatio
    };
  }
  
  /**
   * CALIBRACIÓN DE GANANCIA FIJA
   */
  private updateGainCalibration(r: number, g: number, b: number): void {
    if (this.calibrationComplete) return;
    
    const currentDC = (r + g + b) / 3;
    this.calibrationSamples++;
    this.calibrationDC += currentDC;
    
    if (this.calibrationSamples >= this.CALIBRATION_FRAMES) {
      this.calibrationDC /= this.calibrationSamples;
      this.calibrationComplete = true;
      
      if (this.calibrationDC > 0) {
        this.gainFactor = this.TARGET_DC / this.calibrationDC;
        this.gainFactor = Math.max(this.MIN_GAIN, Math.min(this.MAX_GAIN, this.gainFactor));
      }
      
      console.log(`🎚️ Calibración: DC=${this.calibrationDC.toFixed(1)}, Gain=${this.gainFactor.toFixed(2)}`);
    }
  }
  
  /**
   * NORMALIZACIÓN
   */
  private applyAdaptiveNormalization(rawValue: number): number {
    if (!this.calibrationComplete) return rawValue;
    const normalized = rawValue * this.gainFactor;
    return Math.max(0, Math.min(255, normalized));
  }
  
  /**
   * Actualizar buffers circulares
   */
  private updateBuffers(red: number, green: number, blue: number): void {
    this.redBuffer.push(red);
    this.greenBuffer.push(green);
    this.blueBuffer.push(blue);
    
    while (this.redBuffer.length > this.BUFFER_SIZE) {
      this.redBuffer.shift();
      this.greenBuffer.shift();
      this.blueBuffer.shift();
    }
  }
  
  /**
   * Calcular componente AC (pulsatilidad)
   */
  private calculateACComponent(): number {
    if (this.redBuffer.length < 30) return 0;
    
    const recent = this.redBuffer.slice(-60);
    const mean = recent.reduce((a, b) => a + b, 0) / recent.length;
    if (mean === 0) return 0;
    
    const variance = recent.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / recent.length;
    const stdDev = Math.sqrt(variance);
    
    return stdDev / mean;
  }
  
  getRedBuffer(): number[] {
    return [...this.redBuffer];
  }
  
  getAllChannelBuffers(): { red: number[], green: number[], blue: number[] } {
    return {
      red: [...this.redBuffer],
      green: [...this.greenBuffer],
      blue: [...this.blueBuffer]
    };
  }
  
  getRGBStats(): { redAC: number; redDC: number; greenAC: number; greenDC: number; rgRatio: number } {
    if (this.redBuffer.length < 30) {
      return { redAC: 0, redDC: 0, greenAC: 0, greenDC: 0, rgRatio: 0 };
    }
    
    const recentRed = this.redBuffer.slice(-60);
    const recentGreen = this.greenBuffer.slice(-60);
    
    const redDC = recentRed.reduce((a, b) => a + b, 0) / recentRed.length;
    const greenDC = recentGreen.reduce((a, b) => a + b, 0) / recentGreen.length;
    const redAC = Math.max(...recentRed) - Math.min(...recentRed);
    const greenAC = Math.max(...recentGreen) - Math.min(...recentGreen);
    
    const rgRatio = (redDC > 0 && greenDC > 0) ? (redAC / redDC) / (greenAC / greenDC) : 0;
    
    return { redAC, redDC, greenAC, greenDC, rgRatio };
  }
  
  detectROI(redValue: number, imageData: ImageData): ProcessedSignal['roi'] {
    return { x: 0, y: 0, width: imageData.width, height: imageData.height };
  }
  
  getSkinPixelRatio(): number {
    return this.skinPixelRatio;
  }
  
  isCalibrated(): boolean {
    return this.calibrationComplete;
  }
  
  getGainFactor(): number {
    return this.gainFactor;
  }
  
  reset(): void {
    this.redBuffer = [];
    this.greenBuffer = [];
    this.blueBuffer = [];
    this.frameCount = 0;
    this.calibrationComplete = false;
    this.calibrationSamples = 0;
    this.calibrationDC = 0;
    this.gainFactor = 1.0;
    this.lastRed = 0;
    this.lastGreen = 0;
    this.lastBlue = 0;
    this.skinPixelRatio = 0;
    this.lastSkinCount = 0;
  }
}
