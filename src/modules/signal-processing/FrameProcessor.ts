import { FrameData } from './types';
import { ProcessedSignal } from '../../types/signal';

/**
 * FRAME PROCESSOR - NUEVA IMPLEMENTACIÓN SIMPLIFICADA
 * 
 * Extrae valores RGB de frames de video de manera directa y simple.
 * Sin calibraciones complejas, solo extracción pura de datos.
 */
export class FrameProcessor {
  // Buffer circular simple
  private readonly BUFFER_SIZE = 90; // 3 segundos @ 30fps
  private redBuffer: number[] = [];
  private greenBuffer: number[] = [];
  private blueBuffer: number[] = [];
  
  // Suavizado exponencial
  private smoothedRed = 0;
  private smoothedGreen = 0;
  private smoothedBlue = 0;
  private readonly ALPHA = 0.3; // Factor de suavizado
  
  // Estadísticas
  private frameCount = 0;
  private skinPixelRatio = 0;
  
  /**
   * Extrae valores RGB promedio del frame
   */
  extractFrameData(imageData: ImageData): FrameData {
    const data = imageData.data;
    const width = imageData.width;
    const height = imageData.height;
    
    // Usar región central (50% del frame) donde está el dedo
    const startX = Math.floor(width * 0.25);
    const endX = Math.floor(width * 0.75);
    const startY = Math.floor(height * 0.25);
    const endY = Math.floor(height * 0.75);
    
    let redSum = 0;
    let greenSum = 0;
    let blueSum = 0;
    let skinCount = 0;
    let totalSampled = 0;
    
    // Muestrear cada 2 píxeles para velocidad
    for (let y = startY; y < endY; y += 2) {
      for (let x = startX; x < endX; x += 2) {
        const i = (y * width + x) * 4;
        
        const r = data[i];
        const g = data[i + 1];
        const b = data[i + 2];
        
        totalSampled++;
        
        // Filtro simple para dedo con flash:
        // - Rojo alto (>80)
        // - Rojo > Verde > Azul
        if (r > 80 && r > g && g > b) {
          redSum += r;
          greenSum += g;
          blueSum += b;
          skinCount++;
        }
      }
    }
    
    this.skinPixelRatio = totalSampled > 0 ? skinCount / totalSampled : 0;
    
    // Si no hay suficientes píxeles de "piel", usar promedio general
    if (skinCount < 50) {
      redSum = 0;
      greenSum = 0;
      blueSum = 0;
      skinCount = 0;
      
      for (let y = startY; y < endY; y += 2) {
        for (let x = startX; x < endX; x += 2) {
          const i = (y * width + x) * 4;
          redSum += data[i];
          greenSum += data[i + 1];
          blueSum += data[i + 2];
          skinCount++;
        }
      }
    }
    
    // Promedios crudos
    const rawRed = skinCount > 0 ? redSum / skinCount : 0;
    const rawGreen = skinCount > 0 ? greenSum / skinCount : 0;
    const rawBlue = skinCount > 0 ? blueSum / skinCount : 0;
    
    // Aplicar suavizado exponencial
    if (this.frameCount === 0) {
      this.smoothedRed = rawRed;
      this.smoothedGreen = rawGreen;
      this.smoothedBlue = rawBlue;
    } else {
      this.smoothedRed = this.ALPHA * rawRed + (1 - this.ALPHA) * this.smoothedRed;
      this.smoothedGreen = this.ALPHA * rawGreen + (1 - this.ALPHA) * this.smoothedGreen;
      this.smoothedBlue = this.ALPHA * rawBlue + (1 - this.ALPHA) * this.smoothedBlue;
    }
    
    // Agregar a buffers
    this.redBuffer.push(this.smoothedRed);
    this.greenBuffer.push(this.smoothedGreen);
    this.blueBuffer.push(this.smoothedBlue);
    
    // Mantener tamaño de buffer
    if (this.redBuffer.length > this.BUFFER_SIZE) {
      this.redBuffer.shift();
      this.greenBuffer.shift();
      this.blueBuffer.shift();
    }
    
    this.frameCount++;
    
    // Log cada 3 segundos
    if (this.frameCount % 90 === 0) {
      console.log(`📷 RGB: R=${this.smoothedRed.toFixed(1)} G=${this.smoothedGreen.toFixed(1)} B=${this.smoothedBlue.toFixed(1)} | Skin=${(this.skinPixelRatio * 100).toFixed(1)}%`);
    }
    
    return {
      redValue: this.smoothedRed,
      avgRed: this.smoothedRed,
      avgGreen: this.smoothedGreen,
      avgBlue: this.smoothedBlue,
      rawRed: rawRed,
      rawGreen: rawGreen,
      rawBlue: rawBlue,
      textureScore: this.calculatePulsatility(),
      rToGRatio: this.smoothedGreen > 0 ? this.smoothedRed / this.smoothedGreen : 1,
      rToBRatio: this.smoothedBlue > 0 ? this.smoothedRed / this.smoothedBlue : 1
    };
  }
  
  /**
   * Calcula pulsatilidad del canal rojo (AC/DC)
   */
  private calculatePulsatility(): number {
    if (this.redBuffer.length < 30) return 0;
    
    const recentRed = this.redBuffer.slice(-30);
    const min = Math.min(...recentRed);
    const max = Math.max(...recentRed);
    const mean = recentRed.reduce((a, b) => a + b, 0) / recentRed.length;
    
    if (mean < 1) return 0;
    
    // Pulsatilidad = (max - min) / (2 * DC)
    return Math.min(0.15, (max - min) / (2 * mean));
  }
  
  /**
   * Obtiene estadísticas RGB para cálculo de SpO2
   */
  getRGBStats(): { redAC: number; redDC: number; greenAC: number; greenDC: number; rgRatio: number } {
    if (this.redBuffer.length < 30 || this.greenBuffer.length < 30) {
      return { redAC: 0, redDC: 0, greenAC: 0, greenDC: 0, rgRatio: 0 };
    }
    
    const recentRed = this.redBuffer.slice(-30);
    const recentGreen = this.greenBuffer.slice(-30);
    
    const redMin = Math.min(...recentRed);
    const redMax = Math.max(...recentRed);
    const redDC = recentRed.reduce((a, b) => a + b, 0) / recentRed.length;
    const redAC = redMax - redMin;
    
    const greenMin = Math.min(...recentGreen);
    const greenMax = Math.max(...recentGreen);
    const greenDC = recentGreen.reduce((a, b) => a + b, 0) / recentGreen.length;
    const greenAC = greenMax - greenMin;
    
    // Ratio para SpO2
    const redACnorm = redDC > 0 ? redAC / redDC : 0;
    const greenACnorm = greenDC > 0 ? greenAC / greenDC : 0;
    const rgRatio = greenACnorm > 0.001 ? redACnorm / greenACnorm : 0;
    
    return { redAC, redDC, greenAC, greenDC, rgRatio };
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
  
  detectROI(redValue: number, imageData: ImageData): { x: number; y: number; width: number; height: number } {
    return { 
      x: Math.floor(imageData.width * 0.25), 
      y: Math.floor(imageData.height * 0.25), 
      width: Math.floor(imageData.width * 0.5), 
      height: Math.floor(imageData.height * 0.5) 
    };
  }
  
  getSkinPixelRatio(): number {
    return this.skinPixelRatio;
  }
  
  isCalibrated(): boolean {
    return this.frameCount > 30;
  }
  
  getGainFactor(): number {
    return 1.0;
  }
  
  reset(): void {
    this.redBuffer = [];
    this.greenBuffer = [];
    this.blueBuffer = [];
    this.smoothedRed = 0;
    this.smoothedGreen = 0;
    this.smoothedBlue = 0;
    this.frameCount = 0;
    this.skinPixelRatio = 0;
  }
}
