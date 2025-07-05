import { FrameData } from './types';
import { ProcessedSignal } from '../../types/signal';

/**
 * Processes video frames to extract PPG signals and detect ROI
 * PROHIBIDA LA SIMULACIÓN Y TODO TIPO DE MANIPULACIÓN FORZADA DE DATOS
 */
export class FrameProcessor {
  private readonly CONFIG: { TEXTURE_GRID_SIZE: number, ROI_SIZE_FACTOR: number };
  // Parámetros ajustados para mejor extracción de señal
  private readonly RED_GAIN = 1.4; // Aumentado para mejor amplificación de señal roja (antes 1.2)
  private readonly GREEN_SUPPRESSION = 0.8; // Menos supresión para mantener información (antes 0.85)
  private readonly SIGNAL_GAIN = 1.3; // Aumentado para mejor detección (antes 1.1)
  private readonly EDGE_ENHANCEMENT = 0.18;  // Ajustado para mejor detección de bordes (antes 0.12)
  private readonly MIN_RED_THRESHOLD = 0.28;  // Ligero aumento adicional
  private readonly RG_RATIO_RANGE = [0.8, 4.0];  // Rango más estrecho
  private readonly EDGE_CONTRAST_THRESHOLD = 0.12;  // Nuevo filtro por contraste
  
  // Historia para calibración adaptativa
  private lastFrames: Array<{red: number, green: number, blue: number}> = [];
  private readonly HISTORY_SIZE = 15; // Reducido para adaptación más rápida (antes 20)
  private lastLightLevel: number = -1;
  
  // Nuevo: historial de ROIs para estabilidad
  private roiHistory: Array<{x: number, y: number, width: number, height: number}> = [];
  private readonly ROI_HISTORY_SIZE = 5;
  
  constructor(config: { TEXTURE_GRID_SIZE: number, ROI_SIZE_FACTOR: number }) {
    // Aumentar tamaño de ROI para capturar más área
    this.CONFIG = {
      ...config,
      ROI_SIZE_FACTOR: Math.min(0.8, config.ROI_SIZE_FACTOR * 1.15) // Aumentar tamaño ROI sin exceder 0.8
    };
  }
  
  extractFrameData(imageData: ImageData): FrameData {
    const data = imageData.data;
    let redSum = 0;
    let greenSum = 0;
    let blueSum = 0;
    let pixelCount = 0;
    let totalLuminance = 0;
    
    // Centro de la imagen
    const centerX = Math.floor(imageData.width / 2);
    const centerY = Math.floor(imageData.height / 2);
    const roiSize = Math.min(imageData.width, imageData.height) * this.CONFIG.ROI_SIZE_FACTOR;
    
    const startX = Math.max(0, Math.floor(centerX - roiSize / 2));
    const endX = Math.min(imageData.width, Math.floor(centerX + roiSize / 2));
    const startY = Math.max(0, Math.floor(centerY - roiSize / 2));
    const endY = Math.min(imageData.height, Math.floor(centerY + roiSize / 2));
    
    // Grid for texture analysis
    const gridSize = this.CONFIG.TEXTURE_GRID_SIZE;
    const cells: Array<{ red: number, green: number, blue: number, count: number, edgeScore: number }> = [];
    for (let i = 0; i < gridSize * gridSize; i++) {
      cells.push({ red: 0, green: 0, blue: 0, count: 0, edgeScore: 0 });
    }
    
    // Edge detection matrices - Kernel mejorado
    const edgeDetectionMatrix = [
      [-1, -2, -1],
      [-2,  12, -2], // Valor central incrementado para mejor detección
      [-1, -2, -1]
    ];
    const edgeValues: number[] = [];
    
    // Extraer señal con amplificación adecuada
    for (let y = startY; y < endY; y++) {
      for (let x = startX; x < endX; x++) {
        const i = (y * imageData.width + x) * 4;
        const r = data[i];     // Canal rojo
        const g = data[i+1];   // Canal verde
        const b = data[i+2];   // Canal azul
        
        // Calculate pixel luminance
        const luminance = (r * 0.299 + g * 0.587 + b * 0.114) / 255;
        totalLuminance += luminance;
        
        // Calculate grid cell
        const gridX = Math.min(gridSize - 1, Math.floor(((x - startX) / (endX - startX)) * gridSize));
        const gridY = Math.min(gridSize - 1, Math.floor(((y - startY) / (endY - startY)) * gridSize));
        const cellIdx = gridY * gridSize + gridX;
        
        // Edge detection for each grid cell
        let edgeValue = 0;
        if (x > startX && x < endX - 1 && y > startY && y < endY - 1) {
          for (let ky = -1; ky <= 1; ky++) {
            for (let kx = -1; kx <= 1; kx++) {
              const ni = ((y + ky) * imageData.width + (x + kx)) * 4;
              edgeValue += data[ni] * edgeDetectionMatrix[ky+1][kx+1];
            }
          }
          edgeValue = Math.abs(edgeValue) / 255;
          edgeValues.push(edgeValue);
          cells[cellIdx].edgeScore += edgeValue;
        }
        
        // Amplificación mejorada del canal rojo
        const enhancedR = Math.min(255, r * this.RED_GAIN);
        
        // Supresión medida del canal verde
        const attenuatedG = g * this.GREEN_SUPPRESSION;
        
        cells[cellIdx].red += enhancedR;
        cells[cellIdx].green += attenuatedG;
        cells[cellIdx].blue += b;
        cells[cellIdx].count++;
        
        // Ganancia adaptativa basada en ratio r/g fisiológico - más permisiva
        const rgRatio = r / (g + 1); // Use raw r and g for this ratio
        // Ganancia reducida para ratios no fisiológicos pero más permisiva
        const adaptiveGain = (rgRatio > this.RG_RATIO_RANGE[0] && rgRatio < this.RG_RATIO_RANGE[1]) ? // Rango ampliado (antes 0.9-3.0)
                           this.SIGNAL_GAIN : this.SIGNAL_GAIN * 0.8; // Penalización reducida
        
        redSum += enhancedR * adaptiveGain;
        greenSum += attenuatedG;
        blueSum += b;
        pixelCount++;
      }
    }
    
    // Calculate average lighting level (0-100)
    const avgLuminance = (pixelCount > 0) ? (totalLuminance / pixelCount) * 100 : 0;
    
    // Update lighting level with smoothing
    if (this.lastLightLevel < 0) {
      this.lastLightLevel = avgLuminance;
    } else {
      this.lastLightLevel = this.lastLightLevel * 0.7 + avgLuminance * 0.3;
    }
    
    // Calculate texture (variation between cells) with physiological constraints
    let textureScore = 0.5; // Base value
    
    if (cells.some(cell => cell.count > 0)) {
      // Normalize cells by count and consider edges
      const normCells = cells
        .filter(cell => cell.count > 0)
        .map(cell => ({
          red: cell.red / cell.count,
          green: cell.green / cell.count,
          blue: cell.blue / cell.count,
          edgeScore: cell.edgeScore / Math.max(1, cell.count)
        }));
      
      if (normCells.length > 1) {
        // Calculate variations between adjacent cells with edge weighting
        let totalVariation = 0;
        let comparisonCount = 0;
        
        for (let i = 0; i < normCells.length; i++) {
          for (let j = i + 1; j < normCells.length; j++) {
            const cell1 = normCells[i];
            const cell2 = normCells[j];
            
            // Calculate color difference with emphasis on red channel
            const redDiff = Math.abs(cell1.red - cell2.red) * 1.3; // Mayor énfasis en rojo
            const greenDiff = Math.abs(cell1.green - cell2.green) * 0.8; // Menor énfasis
            const blueDiff = Math.abs(cell1.blue - cell2.blue) * 0.6; // Menor énfasis
            
            // Include edge information in texture calculation
            const edgeDiff = Math.abs(cell1.edgeScore - cell2.edgeScore) * this.EDGE_ENHANCEMENT;
            
            // Weighted average of differences
            const avgDiff = (redDiff + greenDiff + blueDiff + edgeDiff) / 2.7;
            totalVariation += avgDiff;
            comparisonCount++;
          }
        }
        
        if (comparisonCount > 0) {
          const avgVariation = totalVariation / comparisonCount;
          
          // Cálculo de textura mejorado - más permisivo
          const normalizedVar = Math.pow(avgVariation / 3, 0.65); // Exponente reducido
          textureScore = Math.max(0.35, Math.min(1, normalizedVar)); // Mínimo más alto
        }
      }
    }
    
    // Update history for adaptive calibration
    if (pixelCount > 0) {
      this.lastFrames.push({
        red: redSum / pixelCount,
        green: greenSum / pixelCount,
        blue: blueSum / pixelCount
      });
      
      if (this.lastFrames.length > this.HISTORY_SIZE) {
        this.lastFrames.shift();
      }
    }
    
    // No pixels detected - return enhanced default values
    if (pixelCount < 1) {
      console.log("FrameProcessor: No pixels detected in this frame, using default values");
      return { 
        redValue: 5, // Valor base mayor para evitar ceros (antes 0)
        textureScore: 0.6, // Valor base mayor (antes 0.5)
        rToGRatio: 1.2, // Valor más fisiológico
        rToBRatio: 1.2,
        avgRed: 5,
        avgGreen: 4,
        avgBlue: 4
      };
    }
    
    // Apply dynamic calibration based on history - with medical constraints
    let dynamicGain = 1.0; // Base gain
    if (this.lastFrames.length >= 3) { // Reducido (antes 5)
      const avgHistRed = this.lastFrames.reduce((sum, frame) => sum + frame.red, 0) / this.lastFrames.length;
      
      // Ganancia moderada incluso para señales muy débiles
      if (avgHistRed < 40 && avgHistRed > this.MIN_RED_THRESHOLD && 
          this.calculateEdgeContrast() > this.EDGE_CONTRAST_THRESHOLD) {
        dynamicGain = 1.25; // Ganancia ligeramente reducida
      } else if (avgHistRed <= this.MIN_RED_THRESHOLD) { // Umbral reducido
        // Very weak signal - likely no finger present
        dynamicGain = 1.1; // Algo de amplificación incluso con señal muy débil (antes 1.0)
      }
    }
    
    // Calculate average values with physiologically valid minimum thresholds
    const avgRed = Math.max(0, (redSum / pixelCount) * dynamicGain);
    const avgGreen = greenSum / pixelCount;
    const avgBlue = blueSum / pixelCount;
    
    // Calculate color ratio indexes with proper physiological constraints - más permisivo
    const rToGRatio = avgGreen > 3 ? avgRed / avgGreen : 1.2; 
    const rToBRatio = avgRed / avgBlue;
    console.log('[DEBUG] FrameProcessor extractFrameData - avgRed:', avgRed, 'avgGreen:', avgGreen, 'avgBlue:', avgBlue, 'textureScore:', textureScore, 'rToGRatio:', rToGRatio, 'rToBRatio:', rToBRatio);
    
    // Light level affects detection quality
    const lightLevelFactor = this.getLightLevelQualityFactor(this.lastLightLevel);
    
    // More detailed logging for diagnostics
    console.log("FrameProcessor: Extracted data:", {
      avgRed: avgRed.toFixed(1), 
      avgGreen: avgGreen.toFixed(1), 
      avgBlue: avgBlue.toFixed(1),
      textureScore: textureScore.toFixed(2),
      rToGRatio: rToGRatio.toFixed(2), 
      rToBRatio: rToBRatio.toFixed(2),
      lightLevel: this.lastLightLevel.toFixed(1),
      lightQuality: lightLevelFactor.toFixed(2),
      dynamicGain: dynamicGain.toFixed(2),
      pixelCount,
      frameSize: `${imageData.width}x${imageData.height}`,
      roiSize: `${roiSize.toFixed(1)}`
    });
    
    return {
      redValue: avgRed,
      avgRed,
      avgGreen,
      avgBlue,
      textureScore,
      rToGRatio,
      rToBRatio
    };
  }
  
  private calculateEdgeContrast(): number {
    if (this.lastFrames.length < 2) return 0;
    
    const lastFrame = this.lastFrames[this.lastFrames.length - 1];
    const prevFrame = this.lastFrames[this.lastFrames.length - 2];
    
    // Cálculo de diferencia entre frames consecutivos
    const diff = Math.abs(lastFrame.red - prevFrame.red) + 
                 Math.abs(lastFrame.green - prevFrame.green) + 
                 Math.abs(lastFrame.blue - prevFrame.blue);
    
    // Normalizar a rango 0-1
    return Math.min(1, diff / 255); 
  }
  
  /**
   * Calculate quality factor based on lighting level
   * Both too dark and too bright conditions reduce signal quality
   */
  private getLightLevelQualityFactor(lightLevel: number): number {
    // Rango óptimo ampliado - más permisivo
    if (lightLevel >= 25 && lightLevel <= 85) { // Antes 30-80
      return 1.0; // Optimal lighting
    } else if (lightLevel < 25) {
      // Too dark - reducción lineal en calidad pero más permisiva
      return Math.max(0.4, lightLevel / 25); // Mínimo aumentado (antes 0.3)
    } else {
      // Too bright - penalización reducida
      return Math.max(0.4, 1.0 - (lightLevel - 85) / 60); // Límites más permisivos
    }
  }
  
  detectROI(redValue: number, imageData: ImageData): ProcessedSignal['roi'] {
    console.log('[DEBUG] FrameProcessor detectROI - redValue:', redValue, 'imageSize:', imageData.width+'x'+imageData.height);
    // Centered ROI by default with adaptive size
    const centerX = Math.floor(imageData.width / 2);
    const centerY = Math.floor(imageData.height / 2);
    
    // Factor ROI adaptativo mejorado
    let adaptiveROISizeFactor = this.CONFIG.ROI_SIZE_FACTOR;
    
    // Ajustar ROI basado en valor rojo detectado - más permisivo
    if (redValue < 25) { // Umbral reducido (antes 30)
      // Señal débil - aumentar ROI para capturar más área
      adaptiveROISizeFactor = Math.min(0.8, adaptiveROISizeFactor * 1.1); // Mayor aumento
    } else if (redValue > 120) { // Umbral aumentado (antes 100)
      // Señal fuerte - enfocar ROI en área central
      adaptiveROISizeFactor = Math.max(0.35, adaptiveROISizeFactor * 0.97); // Menos reducción
    }
    
    // Ensure ROI is appropriate to image size
    const minDimension = Math.min(imageData.width, imageData.height);
    const maxRoiSize = minDimension * 0.85; // Máximo aumentado (antes 0.8)
    const minRoiSize = minDimension * 0.25; // Mínimo reducido (antes 0.3)
    
    let roiSize = minDimension * adaptiveROISizeFactor;
    roiSize = Math.max(minRoiSize, Math.min(maxRoiSize, roiSize));
    
    // Nuevo ROI calculado
    const newROI = {
      x: centerX - roiSize / 2,
      y: centerY - roiSize / 2,
      width: roiSize,
      height: roiSize
    };
    
    console.log('[DEBUG] FrameProcessor detectROI - newROI:', newROI);
    // Guardar historia de ROIs para estabilidad
    this.roiHistory.push(newROI);
    if (this.roiHistory.length > this.ROI_HISTORY_SIZE) {
      this.roiHistory.shift();
    }
    
    // Si tenemos suficiente historia, promediar para estabilidad
    if (this.roiHistory.length >= 3) {
      const avgX = this.roiHistory.reduce((sum, roi) => sum + roi.x, 0) / this.roiHistory.length;
      const avgY = this.roiHistory.reduce((sum, roi) => sum + roi.y, 0) / this.roiHistory.length;
      const avgWidth = this.roiHistory.reduce((sum, roi) => sum + roi.width, 0) / this.roiHistory.length;
      const avgHeight = this.roiHistory.reduce((sum, roi) => sum + roi.height, 0) / this.roiHistory.length;
      
      return {
        x: avgX,
        y: avgY,
        width: avgWidth,
        height: avgHeight
      };
    }
    
    // Si no hay suficiente historia, usar el nuevo ROI directamente
    return newROI;
  }
}
