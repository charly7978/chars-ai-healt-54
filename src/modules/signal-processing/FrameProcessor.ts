import { FrameData } from './types';
import { ProcessedSignal } from '../../types/signal';

/**
 * FrameProcessor - EXTRACCIÓN DE SEÑAL ADAPTATIVA
 * 
 * MEJORAS BASADAS EN MacIsaac et al. 2025 (PMC/MDPI):
 * "Programmable Gain Calibration Method to Mitigate Skin Tone Bias in PPG Sensors"
 * 
 * FUNCIONALIDADES:
 * 1. Normalización adaptativa por tono de piel
 * 2. Control automático de ganancia (AGC)
 * 3. Calibración dinámica DC/AC
 * 4. Robustez ante cambios de iluminación
 */
export class FrameProcessor {
  // ROI grande para capturar toda la yema del dedo
  private readonly ROI_SIZE_FACTOR: number = 0.85;
  
  // Buffer para análisis temporal de la señal
  private redBuffer: number[] = [];
  private greenBuffer: number[] = [];
  private blueBuffer: number[] = [];
  private readonly BUFFER_SIZE = 90; // 3 segundos a 30fps
  
  // === CALIBRACIÓN ADAPTATIVA ===
  private calibrationDC: number = 0;
  private calibrationComplete: boolean = false;
  private calibrationSamples: number = 0;
  private readonly CALIBRATION_FRAMES = 30; // 1 segundo para calibrar
  
  // Control automático de ganancia
  private gainFactor: number = 1.0;
  private readonly TARGET_DC = 128; // Valor DC objetivo medio
  private readonly MIN_GAIN = 0.3;
  private readonly MAX_GAIN = 3.0;
  
  // Historial para normalización
  private dcHistory: number[] = [];
  private readonly DC_HISTORY_SIZE = 15;
  
  // Log de valores cada N frames para debug
  private frameCount = 0;
  private readonly LOG_EVERY = 90; // Log cada 3 segundos
  
  constructor(config?: { TEXTURE_GRID_SIZE?: number, ROI_SIZE_FACTOR?: number }) {
    if (config?.ROI_SIZE_FACTOR) {
      this.ROI_SIZE_FACTOR = config.ROI_SIZE_FACTOR;
    }
  }
  
  /**
   * Extrae los valores RGB con NORMALIZACIÓN ADAPTATIVA
   * Compensa automáticamente por tono de piel y condiciones de luz
   */
  extractFrameData(imageData: ImageData): FrameData {
    const data = imageData.data;
    const width = imageData.width;
    const height = imageData.height;
    
    // ROI centrada muy amplia para capturar toda la yema
    const roiSize = Math.min(width, height) * this.ROI_SIZE_FACTOR;
    const centerX = Math.floor(width / 2);
    const centerY = Math.floor(height / 2);
    const halfRoi = Math.floor(roiSize / 2);
    
    const startX = Math.max(0, centerX - halfRoi);
    const endX = Math.min(width, centerX + halfRoi);
    const startY = Math.max(0, centerY - halfRoi);
    const endY = Math.min(height, centerY + halfRoi);
    
    let redSum = 0;
    let greenSum = 0;
    let blueSum = 0;
    let pixelCount = 0;
    
    // Muestreo inteligente: cada 2 píxeles para velocidad
    const step = 2;
    
    for (let y = startY; y < endY; y += step) {
      for (let x = startX; x < endX; x += step) {
        const i = (y * width + x) * 4;
        redSum += data[i];     // R
        greenSum += data[i+1]; // G
        blueSum += data[i+2];  // B
        pixelCount++;
      }
    }
    
    // Calcular promedios crudos
    const rawRed = pixelCount > 0 ? redSum / pixelCount : 0;
    const rawGreen = pixelCount > 0 ? greenSum / pixelCount : 0;
    const rawBlue = pixelCount > 0 ? blueSum / pixelCount : 0;
    
    // === CALIBRACIÓN DE GANANCIA AUTOMÁTICA (AGC) ===
    // Basado en MacIsaac et al. 2025: "Programmable Gain Calibration"
    this.updateGainCalibration(rawRed, rawGreen, rawBlue);
    
    // Aplicar ganancia adaptativa
    const avgRed = this.applyAdaptiveNormalization(rawRed);
    const avgGreen = this.applyAdaptiveNormalization(rawGreen);
    const avgBlue = this.applyAdaptiveNormalization(rawBlue);
    
    // Log de diagnóstico cada N frames
    this.frameCount++;
    if (this.frameCount % this.LOG_EVERY === 0) {
      const rgRatio = avgGreen > 0 ? (avgRed / avgGreen).toFixed(2) : 'N/A';
      const redPct = (avgRed / (avgRed + avgGreen + avgBlue) * 100).toFixed(1);
      console.log(`📊 Frame ${this.frameCount}: R=${avgRed.toFixed(0)}, G=${avgGreen.toFixed(0)}, B=${avgBlue.toFixed(0)} | R/G=${rgRatio} | Red%=${redPct}%`);
    }
    
    // Actualizar buffers para análisis temporal
    this.updateBuffers(avgRed, avgGreen, avgBlue);
    
    // Calcular ratios para análisis de tejido
    const rToGRatio = avgGreen > 0 ? avgRed / avgGreen : 1;
    const rToBRatio = avgBlue > 0 ? avgRed / avgBlue : 1;
    
    // Calcular variabilidad AC (componente pulsátil)
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
   * CALIBRACIÓN DE GANANCIA AUTOMÁTICA
   * 
   * Ajusta la ganancia según el nivel DC base (tono de piel)
   * - Piel oscura: DC bajo → aumentar ganancia
   * - Piel clara: DC alto → reducir ganancia
   * - Mantiene rango dinámico óptimo para detección de pulso
   */
  private updateGainCalibration(r: number, g: number, b: number): void {
    const currentDC = (r + g + b) / 3;
    
    // Acumular historial DC
    this.dcHistory.push(currentDC);
    if (this.dcHistory.length > this.DC_HISTORY_SIZE) {
      this.dcHistory.shift();
    }
    
    // Fase de calibración inicial
    if (!this.calibrationComplete) {
      this.calibrationSamples++;
      this.calibrationDC += currentDC;
      
      if (this.calibrationSamples >= this.CALIBRATION_FRAMES) {
        this.calibrationDC /= this.calibrationSamples;
        this.calibrationComplete = true;
        
        // Calcular ganancia inicial basada en tono de piel
        if (this.calibrationDC > 0) {
          this.gainFactor = this.TARGET_DC / this.calibrationDC;
          this.gainFactor = Math.max(this.MIN_GAIN, Math.min(this.MAX_GAIN, this.gainFactor));
        }
        
        console.log(`🎚️ Calibración completa: DC=${this.calibrationDC.toFixed(1)}, Ganancia=${this.gainFactor.toFixed(2)}`);
      }
      return;
    }
    
    // Adaptación continua suave (evita cambios bruscos)
    if (this.dcHistory.length >= 10) {
      const recentDC = this.dcHistory.slice(-10).reduce((a, b) => a + b, 0) / 10;
      const idealGain = this.TARGET_DC / recentDC;
      const clampedGain = Math.max(this.MIN_GAIN, Math.min(this.MAX_GAIN, idealGain));
      
      // Suavizado exponencial muy lento (0.02) para evitar oscilaciones
      this.gainFactor = this.gainFactor * 0.98 + clampedGain * 0.02;
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
   * Detecta la ROI basada en el valor rojo actual
   */
  detectROI(redValue: number, imageData: ImageData): ProcessedSignal['roi'] {
    const width = imageData.width;
    const height = imageData.height;
    const roiSize = Math.min(width, height) * this.ROI_SIZE_FACTOR;
    
    return {
      x: (width - roiSize) / 2,
      y: (height - roiSize) / 2,
      width: roiSize,
      height: roiSize
    };
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
    this.dcHistory = [];
    this.frameCount = 0;
    this.calibrationComplete = false;
    this.calibrationSamples = 0;
    this.calibrationDC = 0;
    this.gainFactor = 1.0;
  }
}
