import { FrameData } from './types';
import { ProcessedSignal } from '../../types/signal';

/**
 * FrameProcessor - EXTRACCIÓN PPG CON AUTO-CALIBRACIÓN
 * 
 * MEJORAS BASADAS EN LITERATURA:
 * - HKUST 2023: Control de exposición óptimo para rPPG
 * - PMC9136485: Full-frame averaging con detección de piel
 * - Matsumura 2020: Canal verde para reflectancia
 * 
 * NUEVO: Integración con CameraAutoCalibrator para ajuste dinámico
 */
export class FrameProcessor {
  // Buffer para análisis temporal - REDUCIDO: 90 frames (~3s @ 30fps)
  private redBuffer: number[] = [];
  private greenBuffer: number[] = [];
  private blueBuffer: number[] = [];
  private readonly BUFFER_SIZE = 90; // Reducido de 240 - suficiente para AC/DC
  
  // === CALIBRACIÓN ADAPTATIVA ===
  private calibrationDC: number = 0;
  private calibrationComplete: boolean = false;
  private calibrationSamples: number = 0;
  private readonly CALIBRATION_FRAMES = 30;
  
  // Control automático de ganancia - AJUSTADO para evitar saturación
  private gainFactor: number = 1.0;
  private readonly TARGET_DC = 120; // Reducido de 140 a 120 (menos saturación)
  private readonly MIN_GAIN = 0.3; // Permitir más reducción
  private readonly MAX_GAIN = 1.5; // Limitar ganancia máxima
  
  // Suavizado temporal REDUCIDO para preservar pulsatilidad
  private lastRed: number = 0;
  private lastGreen: number = 0;
  private lastBlue: number = 0;
  private readonly SMOOTHING = 0.25; // 25% anterior, 75% nuevo - MÁS REACTIVO
  
  // Log - REDUCIDO para menos overhead
  private frameCount = 0;
  private readonly LOG_EVERY = 150; // cada 5s @ 30fps (era 1.5s)
  
  // Estadísticas
  private skinPixelRatio: number = 0;
  private lastSkinCount: number = 0;
  
  // Detección de saturación
  private saturationCount: number = 0;
  private readonly SATURATION_THRESHOLD = 245; // Píxeles casi blancos
  
  constructor(config?: { TEXTURE_GRID_SIZE?: number, ROI_SIZE_FACTOR?: number }) {}
  
  /**
   * EXTRACCIÓN FULL-FRAME CON DETECCIÓN DE SATURACIÓN
   * 
   * MEJORAS:
   * - Detectar píxeles saturados (>245) y reportar
   * - Notificar al auto-calibrador para ajustar exposición
   * - Usar canal verde para PPG (mejor SNR según literatura)
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
    let saturatedPixels = 0;
    
    // PROCESAR TODOS LOS PÍXELES
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      
      // DETECTAR SATURACIÓN
      if (r > this.SATURATION_THRESHOLD || g > this.SATURATION_THRESHOLD) {
        saturatedPixels++;
      }
      
      // DETECCIÓN DE PIEL
      const total = r + g + b;
      if (total < 50) continue;
      
      const nr = r / total;
      const ng = g / total;
      const nrng = ng > 0.01 ? nr / ng : 0;
      
      if (nr > 0.33 && nrng > 1.0 && r > 40) {
        redSum += r;
        greenSum += g;
        blueSum += b;
        skinPixelCount++;
      }
    }
    
    // Calcular ratio de saturación
    const saturationRatio = saturatedPixels / totalPixels;
    this.saturationCount = saturatedPixels;
    
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
    
    // Actualizar buffers PRIMERO (necesario para calcular AC)
    this.updateBuffers(avgRed, avgGreen, avgBlue);
    
    // Calcular ratios
    const rToGRatio = avgGreen > 0 ? avgRed / avgGreen : 1;
    const rToBRatio = avgBlue > 0 ? avgRed / avgBlue : 1;
    
    // Calcular AC (pulsatilidad)
    const acComponent = this.calculateACComponent();
    
    // Log de diagnóstico con saturación
    this.frameCount++;
    if (this.frameCount % this.LOG_EVERY === 0) {
      const rgRatio = avgGreen > 0 ? (avgRed / avgGreen).toFixed(2) : 'N/A';
      const skinPct = (this.skinPixelRatio * 100).toFixed(1);
      const satPct = (this.saturationCount / (imageData.width * imageData.height) * 100).toFixed(1);
      const brightness = ((avgRed + avgGreen + avgBlue) / 3).toFixed(0);
      console.log(`🖐️ PPG: R=${avgRed.toFixed(0)} G=${avgGreen.toFixed(0)} B=${brightness} | R/G=${rgRatio} | Skin=${skinPct}% | Sat=${satPct}%`);
      
      // Si hay mucha saturación, notificar
      if (parseFloat(satPct) > 20) {
        console.warn('⚠️ SATURACIÓN ALTA - Reducir exposición');
        const calibrator = (window as any).__cameraCalibrator;
        if (calibrator?.forceReduceExposure) {
          calibrator.forceReduceExposure();
        }
      }
    }
    
    // Notificar al auto-calibrador CADA 5 FRAMES (~166ms @ 30fps)
    // MUY frecuente para reaccionar rápido a cambios de luz
    if (this.frameCount % 5 === 0) {
      const calibrator = (window as any).__cameraCalibrator;
      if (calibrator?.analyzeAndAdjust) {
        calibrator.analyzeAndAdjust(avgRed, avgGreen, avgBlue, acComponent);
      }
    }
    
    return {
      redValue: avgRed,
      avgRed,
      avgGreen,
      avgBlue,
      // NUEVO: Valores crudos sin normalizar para detección de dedo
      rawRed: smoothedRed,
      rawGreen: smoothedGreen,
      rawBlue: smoothedBlue,
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
