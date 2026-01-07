import { FrameData } from './types';
import { ProcessedSignal } from '../../types/signal';

/**
 * FrameProcessor - EXTRACCIÓN ROBUSTA FULL-FRAME
 * 
 * TÉCNICA: En lugar de usar un ROI pequeño centrado, promediamos
 * TODOS los píxeles que parecen piel/dedo (rojo dominante).
 * 
 * Esto hace la lectura MUCHO más robusta a micro-movimientos
 * porque no dependemos de una posición exacta.
 * 
 * BASADO EN:
 * - pyVHR Framework: Full-frame skin averaging
 * - Skin detection: nr/ng ratio > 1.185
 */
export class FrameProcessor {
  // Buffer para análisis temporal de la señal
  private redBuffer: number[] = [];
  private greenBuffer: number[] = [];
  private blueBuffer: number[] = [];
  private readonly BUFFER_SIZE = 120; // 4 segundos a 30fps
  
  // === CALIBRACIÓN ADAPTATIVA ===
  private calibrationDC: number = 0;
  private calibrationComplete: boolean = false;
  private calibrationSamples: number = 0;
  private readonly CALIBRATION_FRAMES = 20; // Calibración rápida
  
  // Control automático de ganancia
  private gainFactor: number = 1.0;
  private readonly TARGET_DC = 140; // Valor DC objetivo
  private readonly MIN_GAIN = 0.4;
  private readonly MAX_GAIN = 2.5;
  
  // Suavizado temporal para estabilidad
  private lastRed: number = 0;
  private lastGreen: number = 0;
  private lastBlue: number = 0;
  private readonly SMOOTHING = 0.7; // 70% valor anterior, 30% nuevo
  
  // Log de valores cada N frames para debug
  private frameCount = 0;
  private readonly LOG_EVERY = 60;
  
  // Estadísticas de detección de piel
  private skinPixelRatio: number = 0;
  
  constructor(config?: { TEXTURE_GRID_SIZE?: number, ROI_SIZE_FACTOR?: number }) {
    // Config ignorado - ahora usamos full-frame
  }
  
  /**
   * EXTRACCIÓN FULL-FRAME CON DETECCIÓN DE PIEL
   * 
   * En lugar de usar un ROI fijo, analizamos TODO el frame
   * y promediamos solo los píxeles que parecen piel/dedo.
   * 
   * Esto es MUCHO más robusto a movimientos porque:
   * - No dependemos de posición exacta
   * - Promediamos miles de píxeles en vez de cientos
   * - La señal se mantiene aunque el dedo se mueva un poco
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
    
    // Muestreo: cada 3 píxeles para velocidad (aún miles de muestras)
    const step = 3;
    
    for (let i = 0; i < data.length; i += 4 * step) {
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      
      // DETECCIÓN DE PIEL: Solo incluir píxeles que parecen dedo
      // Basado en ratio R/G y luminancia mínima
      const total = r + g + b;
      if (total < 60) continue; // Muy oscuro, ignorar
      
      const rRatio = r / total;
      const gRatio = g / total;
      
      // Criterio de piel/dedo: R dominante sobre G
      // nr/ng > 1.0 significa más rojo que verde (típico de piel iluminada)
      if (rRatio > 0.30 && rRatio / gRatio >= 0.85) {
        redSum += r;
        greenSum += g;
        blueSum += b;
        skinPixelCount++;
      }
    }
    
    // Calcular ratio de píxeles de piel detectados
    const sampledPixels = Math.floor(totalPixels / step);
    this.skinPixelRatio = skinPixelCount / sampledPixels;
    
    // Si hay muy pocos píxeles de piel, usar promedio general con umbral bajo
    if (skinPixelCount < 100) {
      // Fallback: promediar todo el frame
      redSum = 0; greenSum = 0; blueSum = 0;
      for (let i = 0; i < data.length; i += 4 * step * 2) {
        redSum += data[i];
        greenSum += data[i + 1];
        blueSum += data[i + 2];
        skinPixelCount++;
      }
    }
    
    // Calcular promedios crudos
    const rawRed = skinPixelCount > 0 ? redSum / skinPixelCount : 0;
    const rawGreen = skinPixelCount > 0 ? greenSum / skinPixelCount : 0;
    const rawBlue = skinPixelCount > 0 ? blueSum / skinPixelCount : 0;
    
    // === SUAVIZADO TEMPORAL ===
    // Evita saltos bruscos en la señal por frames individuales malos
    const smoothedRed = this.lastRed * this.SMOOTHING + rawRed * (1 - this.SMOOTHING);
    const smoothedGreen = this.lastGreen * this.SMOOTHING + rawGreen * (1 - this.SMOOTHING);
    const smoothedBlue = this.lastBlue * this.SMOOTHING + rawBlue * (1 - this.SMOOTHING);
    
    this.lastRed = smoothedRed;
    this.lastGreen = smoothedGreen;
    this.lastBlue = smoothedBlue;
    
    // === CALIBRACIÓN DE GANANCIA ===
    this.updateGainCalibration(smoothedRed, smoothedGreen, smoothedBlue);
    
    // Aplicar ganancia adaptativa
    const avgRed = this.applyAdaptiveNormalization(smoothedRed);
    const avgGreen = this.applyAdaptiveNormalization(smoothedGreen);
    const avgBlue = this.applyAdaptiveNormalization(smoothedBlue);
    
    // Log de diagnóstico
    this.frameCount++;
    if (this.frameCount % this.LOG_EVERY === 0) {
      const rgRatio = avgGreen > 0 ? (avgRed / avgGreen).toFixed(2) : 'N/A';
      const skinPct = (this.skinPixelRatio * 100).toFixed(1);
      console.log(`🖐️ Full-Frame: R=${avgRed.toFixed(0)} G=${avgGreen.toFixed(0)} | R/G=${rgRatio} | Skin=${skinPct}%`);
    }
    
    // Actualizar buffers para análisis temporal
    this.updateBuffers(avgRed, avgGreen, avgBlue);
    
    // Calcular ratios
    const rToGRatio = avgGreen > 0 ? avgRed / avgGreen : 1;
    const rToBRatio = avgBlue > 0 ? avgRed / avgBlue : 1;
    
    // Calcular variabilidad AC
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
   * CALIBRACIÓN DE GANANCIA - VERSIÓN ESTABLE
   * 
   * Calibra UNA VEZ y mantiene ganancia fija para evitar drift
   * que causa pérdida de señal cuando el dedo está quieto
   */
  private updateGainCalibration(r: number, g: number, b: number): void {
    const currentDC = (r + g + b) / 3;
    
    // Solo calibrar si no está completo
    if (this.calibrationComplete) {
      // NO hacer adaptación continua - causa pérdida de señal
      return;
    }
    
    // Fase de calibración inicial
    this.calibrationSamples++;
    this.calibrationDC += currentDC;
    
    if (this.calibrationSamples >= this.CALIBRATION_FRAMES) {
      this.calibrationDC /= this.calibrationSamples;
      this.calibrationComplete = true;
      
      // Calcular ganancia FIJA basada en tono de piel
      if (this.calibrationDC > 0) {
        this.gainFactor = this.TARGET_DC / this.calibrationDC;
        this.gainFactor = Math.max(this.MIN_GAIN, Math.min(this.MAX_GAIN, this.gainFactor));
      }
      
      console.log(`🎚️ Calibración FIJA: DC=${this.calibrationDC.toFixed(1)}, Ganancia=${this.gainFactor.toFixed(2)}`);
    }
  }
  
  /**
   * NORMALIZACIÓN ADAPTATIVA
   * 
   * Aplica ganancia calibrada para mantener señal en rango óptimo
   * independientemente del tono de piel o iluminación
   */
  private applyAdaptiveNormalization(rawValue: number): number {
    if (!this.calibrationComplete) {
      return rawValue; // Sin normalización durante calibración
    }
    
    // Aplicar ganancia
    const normalized = rawValue * this.gainFactor;
    
    // Limitar a rango válido (0-255)
    return Math.max(0, Math.min(255, normalized));
  }
  
  /**
   * Actualizar buffers circulares para análisis temporal
   */
  private updateBuffers(red: number, green: number, blue: number): void {
    this.redBuffer.push(red);
    this.greenBuffer.push(green);
    this.blueBuffer.push(blue);
    
    if (this.redBuffer.length > this.BUFFER_SIZE) {
      this.redBuffer.shift();
      this.greenBuffer.shift();
      this.blueBuffer.shift();
    }
  }
  
  /**
   * Calcular componente AC (variación de la señal por pulso)
   * MEJORADO: Usa desviación estándar para mejor precisión
   */
  private calculateACComponent(): number {
    if (this.redBuffer.length < 15) return 0;
    
    const recent = this.redBuffer.slice(-20);
    const mean = recent.reduce((a, b) => a + b, 0) / recent.length;
    
    if (mean === 0) return 0;
    
    // Usar desviación estándar como componente AC (más robusto)
    const variance = recent.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / recent.length;
    const stdDev = Math.sqrt(variance);
    
    // Componente AC normalizado por DC
    return stdDev / mean;
  }
  
  /**
   * Obtener el buffer de canal rojo para análisis externo
   */
  getRedBuffer(): number[] {
    return [...this.redBuffer];
  }
  
  /**
   * Obtener buffers de todos los canales para análisis multicanal
   */
  getAllChannelBuffers(): { red: number[], green: number[], blue: number[] } {
    return {
      red: [...this.redBuffer],
      green: [...this.greenBuffer],
      blue: [...this.blueBuffer]
    };
  }
  
  /**
   * Obtener estadísticas RGB para cálculos externos (SpO2)
   */
  getRGBStats(): {
    redAC: number;
    redDC: number;
    greenAC: number;
    greenDC: number;
    rgRatio: number;
  } {
    if (this.redBuffer.length < 15) {
      return { redAC: 0, redDC: 0, greenAC: 0, greenDC: 0, rgRatio: 0 };
    }
    
    const recentRed = this.redBuffer.slice(-30);
    const recentGreen = this.greenBuffer.slice(-30);
    
    // DC: valor medio
    const redDC = recentRed.reduce((a, b) => a + b, 0) / recentRed.length;
    const greenDC = recentGreen.reduce((a, b) => a + b, 0) / recentGreen.length;
    
    // AC: amplitud pico a pico
    const redAC = Math.max(...recentRed) - Math.min(...recentRed);
    const greenAC = Math.max(...recentGreen) - Math.min(...recentGreen);
    
    // Ratio R/G para SpO2
    const rgRatio = (redDC > 0 && greenDC > 0) 
      ? (redAC / redDC) / (greenAC / greenDC)
      : 0;
    
    return { redAC, redDC, greenAC, greenDC, rgRatio };
  }
  
  /**
   * Detecta la ROI - Ahora retorna full-frame ya que usamos detección de piel
   */
  detectROI(redValue: number, imageData: ImageData): ProcessedSignal['roi'] {
    const width = imageData.width;
    const height = imageData.height;
    
    // Full frame como ROI
    return {
      x: 0,
      y: 0,
      width: width,
      height: height
    };
  }
  
  /**
   * Obtener ratio de píxeles de piel detectados
   */
  getSkinPixelRatio(): number {
    return this.skinPixelRatio;
  }
  
  /**
   * Verificar si la calibración está completa
   */
  isCalibrated(): boolean {
    return this.calibrationComplete;
  }
  
  /**
   * Obtener factor de ganancia actual
   */
  getGainFactor(): number {
    return this.gainFactor;
  }
  
  /**
   * Reset del procesador
   */
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
  }
}
