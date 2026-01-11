import { FrameData } from './types';
import { ProcessedSignal } from '../../types/signal';

/**
 * FrameProcessor - DATOS CRUDOS SIN CALIBRACIÓN
 * 
 * Extrae valores RGB directamente del frame
 * SIN normalización, SIN ganancia, SIN filtros de piel
 */
export class FrameProcessor {
  private redBuffer: number[] = [];
  private greenBuffer: number[] = [];
  private blueBuffer: number[] = [];
  private readonly BUFFER_SIZE = 90; // 3 segundos @ 30fps
  
  private frameCount = 0;
  
  /**
   * Extraer datos CRUDOS del frame
   */
  extractFrameData(imageData: ImageData): FrameData {
    const data = imageData.data;
    const width = imageData.width;
    const height = imageData.height;
    
    // ROI central - 60% del área para mejor captación del dedo
    const roiSize = Math.min(width, height) * 0.6;
    const startX = Math.floor((width - roiSize) / 2);
    const startY = Math.floor((height - roiSize) / 2);
    const endX = startX + Math.floor(roiSize);
    const endY = startY + Math.floor(roiSize);
    
    let redSum = 0;
    let greenSum = 0;
    let blueSum = 0;
    let count = 0;
    
    // Muestrear cada 3 píxeles para velocidad
    for (let y = startY; y < endY; y += 3) {
      for (let x = startX; x < endX; x += 3) {
        const i = (y * width + x) * 4;
        redSum += data[i];
        greenSum += data[i + 1];
        blueSum += data[i + 2];
        count++;
      }
    }
    
    // Promedios CRUDOS - sin ninguna transformación
    const rawRed = count > 0 ? redSum / count : 0;
    const rawGreen = count > 0 ? greenSum / count : 0;
    const rawBlue = count > 0 ? blueSum / count : 0;
    
    // Guardar en buffers
    this.redBuffer.push(rawRed);
    this.greenBuffer.push(rawGreen);
    this.blueBuffer.push(rawBlue);
    
    if (this.redBuffer.length > this.BUFFER_SIZE) {
      this.redBuffer.shift();
      this.greenBuffer.shift();
      this.blueBuffer.shift();
    }
    
    this.frameCount++;
    
    // Log cada 2 segundos - incluir detección de dedo
    if (this.frameCount % 60 === 0) {
      const fingerPresent = rawRed > 100 && rawRed < 255 && (rawRed > rawGreen * 1.2);
      console.log(`📷 RAW: R=${rawRed.toFixed(1)} G=${rawGreen.toFixed(1)} B=${rawBlue.toFixed(1)} | Dedo: ${fingerPresent ? '✅' : '❌'}`);
    }
    
    return {
      redValue: rawRed,
      avgRed: rawRed,
      avgGreen: rawGreen,
      avgBlue: rawBlue,
      rawRed,
      rawGreen,
      rawBlue,
      textureScore: 0,
      rToGRatio: rawGreen > 0 ? rawRed / rawGreen : 1,
      rToBRatio: rawBlue > 0 ? rawRed / rawBlue : 1
    };
  }
  
  getRGBStats(): { redAC: number; redDC: number; greenAC: number; greenDC: number; rgRatio: number } {
    if (this.redBuffer.length < 30) {
      return { redAC: 0, redDC: 0, greenAC: 0, greenDC: 0, rgRatio: 0 };
    }
    
    const recent = this.redBuffer.slice(-30);
    const recentG = this.greenBuffer.slice(-30);
    
    const redDC = recent.reduce((a, b) => a + b, 0) / recent.length;
    const greenDC = recentG.reduce((a, b) => a + b, 0) / recentG.length;
    const redAC = Math.max(...recent) - Math.min(...recent);
    const greenAC = Math.max(...recentG) - Math.min(...recentG);
    
    return { 
      redAC, 
      redDC, 
      greenAC, 
      greenDC, 
      rgRatio: greenDC > 0 ? redDC / greenDC : 0 
    };
  }
  
  detectROI(redValue: number, imageData: ImageData): ProcessedSignal['roi'] {
    return { x: 0, y: 0, width: imageData.width, height: imageData.height };
  }
  
  getIsSaturated(): boolean {
    if (this.redBuffer.length === 0) return false;
    const lastRed = this.redBuffer[this.redBuffer.length - 1];
    return lastRed > 250;
  }
  
  reset(): void {
    this.redBuffer = [];
    this.greenBuffer = [];
    this.blueBuffer = [];
    this.frameCount = 0;
  }
}