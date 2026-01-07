import { FrameData } from './types';
import { ProcessedSignal } from '../../types/signal';

/**
 * FrameProcessor - EXTRACCIÓN DE SEÑAL MULTICANAL
 * 
 * RESPONSABILIDAD: Extraer valores RGB de alta calidad del frame.
 * Captura la YEMA del dedo (área grande, roja, iluminada por flash).
 * 
 * La yema del dedo iluminada produce:
 * - Rojo alto (150-255) por la luz atravesando el tejido
 * - Verde moderado (absorbido por hemoglobina)
 * - Azul bajo (absorbido por hemoglobina)
 */
export class FrameProcessor {
  // ROI grande para capturar toda la yema del dedo
  private readonly ROI_SIZE_FACTOR: number = 0.95;
  
  // Buffer para análisis temporal de la señal
  private redBuffer: number[] = [];
  private greenBuffer: number[] = [];
  private blueBuffer: number[] = [];
  private readonly BUFFER_SIZE = 30;
  
  constructor(config?: { TEXTURE_GRID_SIZE?: number, ROI_SIZE_FACTOR?: number }) {
    if (config?.ROI_SIZE_FACTOR) {
      this.ROI_SIZE_FACTOR = config.ROI_SIZE_FACTOR;
    }
  }
  
  /**
   * Extrae los valores RGB del centro de la imagen (ROI amplia)
   * Optimizado para capturar la yema del dedo completamente
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
    
    // Muestreo inteligente: cada 2 píxeles para velocidad pero buena cobertura
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
    
    // Calcular promedios
    const avgRed = pixelCount > 0 ? redSum / pixelCount : 0;
    const avgGreen = pixelCount > 0 ? greenSum / pixelCount : 0;
    const avgBlue = pixelCount > 0 ? blueSum / pixelCount : 0;
    
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
      textureScore: acComponent, // Usamos AC como indicador de calidad
      rToGRatio,
      rToBRatio
    };
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
   */
  private calculateACComponent(): number {
    if (this.redBuffer.length < 10) return 0;
    
    const recent = this.redBuffer.slice(-15);
    const max = Math.max(...recent);
    const min = Math.min(...recent);
    const mean = recent.reduce((a, b) => a + b, 0) / recent.length;
    
    if (mean === 0) return 0;
    
    // Componente AC normalizado
    return (max - min) / mean;
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
   * Reset del procesador
   */
  reset(): void {
    this.redBuffer = [];
    this.greenBuffer = [];
    this.blueBuffer = [];
  }
}
