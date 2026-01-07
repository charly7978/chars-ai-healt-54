import { FrameData } from './types';
import { ProcessedSignal } from '../../types/signal';

/**
 * FrameProcessor - SIMPLIFICADO
 * 
 * ÚNICA RESPONSABILIDAD: Extraer valores RGB promedio del centro del frame.
 * La detección de dedo se hace en HumanFingerDetector.
 */
export class FrameProcessor {
  private readonly ROI_SIZE_FACTOR: number;
  
  constructor(config: { TEXTURE_GRID_SIZE: number, ROI_SIZE_FACTOR: number }) {
    this.ROI_SIZE_FACTOR = config.ROI_SIZE_FACTOR;
  }
  
  /**
   * Extrae los valores RGB promedio del centro de la imagen (ROI)
   */
  extractFrameData(imageData: ImageData): FrameData {
    const data = imageData.data;
    const width = imageData.width;
    const height = imageData.height;
    
    // Calcular ROI centrada
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
    
    // Iterar sobre la ROI y sumar valores
    for (let y = startY; y < endY; y++) {
      for (let x = startX; x < endX; x++) {
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
    
    return {
      redValue: avgRed,
      avgRed,
      avgGreen,
      avgBlue,
      // Valores legacy para compatibilidad
      textureScore: 0.5,
      rToGRatio: avgGreen > 0 ? avgRed / avgGreen : 1,
      rToBRatio: avgBlue > 0 ? avgRed / avgBlue : 1
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
}
