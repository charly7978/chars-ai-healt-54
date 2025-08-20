import { FrameData } from './types';
import { ProcessedSignal } from '../../types/signal';

/**
 * Processes video frames to extract PPG signals and detect ROI
 * PROHIBIDA LA SIMULACIÓN Y TODO TIPO DE MANIPULACIÓN FORZADA DE DATOS
 */
export class FrameProcessor {
  private readonly CONFIG: { TEXTURE_GRID_SIZE: number, ROI_SIZE_FACTOR: number };
  // Parámetros ajustados PARA REDUCIR FALSOS POSITIVOS - más estrictos
  private readonly RED_GAIN = 1.0; // Reducido para evitar amplificación excesiva
  private readonly GREEN_SUPPRESSION = 0.9; // Menos supresión para comparación más real
  private readonly SIGNAL_GAIN = 0.9; // Reducido para evitar amplificación de ruido
  private readonly EDGE_ENHANCEMENT = 0.15;  // Reducido para ser más conservador
  private readonly MIN_RED_THRESHOLD = 0.35;  // AUMENTADO significativamente para filtrar ruido
  private readonly RG_RATIO_RANGE = [1.0, 3.5];  // Rango más estricto y realista
  private readonly EDGE_CONTRAST_THRESHOLD = 0.18;  // AUMENTADO para mejor validación
  
  // Historia para calibración adaptativa
  private lastFrames: Array<{red: number, green: number, blue: number}> = [];
  private readonly HISTORY_SIZE = 15; // Reducido para adaptación más rápida (antes 20)
  private lastLightLevel: number = -1;
  
  // Nuevo: historial de ROIs para estabilidad
  private roiHistory: Array<{x: number, y: number, width: number, height: number}> = [];
  private readonly ROI_HISTORY_SIZE = 5;
  
  // Nueva: análisis de patrones de movimiento para detectar vibraciones de mesa
  private movementHistory: Array<{avgRed: number, avgGreen: number, avgBlue: number, timestamp: number}> = [];
  private readonly MOVEMENT_HISTORY_SIZE = 8;
  
  constructor(config: { TEXTURE_GRID_SIZE: number, ROI_SIZE_FACTOR: number }) {
    // Aumentar tamaño de ROI para capturar más área
    this.CONFIG = {
      ...config,
      ROI_SIZE_FACTOR: Math.min(0.7, config.ROI_SIZE_FACTOR * 1.15) // Aumentar tamaño ROI sin exceder 0.8
    };
  }
  
  extractFrameData(imageData: ImageData): {
    redValue: number;
    textureScore: number;
    rToGRatio: number;
    rToBRatio: number;
    avgGreen?: number;
    avgBlue?: number;
    skinLikeness: number; // Nueva métrica para detectar piel vs superficie
    stabilityScore: number; // Nueva métrica para detectar estabilidad vs vibración
  } {
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
      console.warn("FrameProcessor: No pixels detected. Returning zero-signal state.");
      return { 
        redValue: 0,       // Un valor inequívoco de no-señal
        textureScore: 0,   // Sin textura
        rToGRatio: 1,      // Ratio neutro
        rToBRatio: 1,      // Ratio neutro
        avgGreen: 0,
        avgBlue: 0,
        skinLikeness: 0,   // Sin similitud con piel
        stabilityScore: 0  // Sin estabilidad
      };
    }
    
    // Apply dynamic calibration based on history - with medical constraints
    let dynamicGain = 1.0; // Base gain
    if (this.lastFrames.length >= 3) { // Reducido (antes 5)
      const avgHistRed = this.lastFrames.reduce((sum, frame) => sum + frame.red, 0) / this.lastFrames.length;
      
        // Ganancia REDUCIDA para señales que no cumplen criterios estrictos
        if (avgHistRed < 50 && avgHistRed > this.MIN_RED_THRESHOLD && 
            this.calculateEdgeContrast() > this.EDGE_CONTRAST_THRESHOLD) {
          dynamicGain = 1.1; // Ganancia muy reducida para evitar amplificar ruido
        } else if (avgHistRed <= this.MIN_RED_THRESHOLD) {
          // Señal muy débil - probablemente no hay dedo
          dynamicGain = 0.9; // Atenuar señal débil para evitar falsos positivos
        }
    }
    
    // Calculate average values with physiologically valid minimum thresholds
    const avgRed = Math.max(0, (redSum / pixelCount) * dynamicGain);
    const avgGreen = greenSum / pixelCount;
    const avgBlue = blueSum / pixelCount;
    
    // NUEVA: Análisis de similitud con piel humana
    const skinLikeness = this.calculateSkinLikeness(avgRed, avgGreen, avgBlue, textureScore);
    
    // NUEVA: Análisis de estabilidad vs vibraciones de mesa
    const stabilityScore = this.calculateStabilityScore(avgRed, avgGreen, avgBlue);
    
    // Calculate color ratio indexes - MÁS ESTRICTOS para reducir falsos positivos
    const rToGRatio = avgGreen > 5 ? avgRed / avgGreen : 1.2; // Umbral más alto para validación
    const rToBRatio = avgBlue > 1 ? avgRed / avgBlue : 1.0; // Evitar división por valores muy pequeños
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
      textureScore,
      rToGRatio,
      rToBRatio,
      avgGreen,
      avgBlue,
      skinLikeness,
      stabilityScore
    };
  }
  
  /**
   * Análisis de similitud con piel humana vs superficies artificiales
   * VERSIÓN ULTRA-ESTRICTA para eliminar falsos positivos
   */
  private calculateSkinLikeness(r: number, g: number, b: number, texture: number): number {
    // Rangos más amplios para diferentes tipos de piel
    const skinRedRange = [50, 250];   
    const skinGreenRange = [25, 210];   
    const skinBlueRange = [15, 170];
    
    // Verificar si los valores están en rangos ESTRICTOS de piel
    const redMatch = (r >= skinRedRange[0] && r <= skinRedRange[1]) ? 1 : 0;
    const greenMatch = (g >= skinGreenRange[0] && g <= skinGreenRange[1]) ? 1 : 0;
    const blueMatch = (b >= skinBlueRange[0] && b <= skinBlueRange[1]) ? 1 : 0;
    
    // Ratio R/G muy permisivo (0.8 - 3.5)
    const rgRatio = g > 0 ? r / g : 0;
    const ratioMatch = (rgRatio >= 0.8 && rgRatio <= 3.5) ? 1 : 0;
    
    // La textura de piel puede variar mucho
    const textureMatch = (texture >= 0.2 && texture <= 0.9) ? 1 : 0;
    
    // NUEVA VALIDACIÓN: Temperatura de color debe ser compatible con piel
    const colorTemp = this.calculateColorTemperature(r, g, b);
    const tempMatch = (colorTemp >= 3000 && colorTemp <= 7000) ? 1 : 0; // Rango de temperatura de piel
    
    // Puntaje combinado MÁS ESTRICTO (máximo 6, normalizado a 0-1)
    const totalScore = (redMatch + greenMatch + blueMatch + ratioMatch + textureMatch + tempMatch) / 6;
    
    // PENALIZACIÓN REDUCIDA - solo fallar en casos extremos
    if (redMatch === 0 && greenMatch === 0) {
      return 0.1; // Permitir casos borderline
    }
    
    return Math.max(0, Math.min(1, totalScore));
  }
  
  /**
   * Calcula temperatura de color aproximada para validar piel humana
   */
  private calculateColorTemperature(r: number, g: number, b: number): number {
    // Aproximación simple de temperatura de color en Kelvin
    if (r === 0 && g === 0 && b === 0) return 0;
    
    const rNorm = r / 255;
    const gNorm = g / 255;
    const bNorm = b / 255;
    
    // Fórmula simplificada para temperatura de color
    if (rNorm > gNorm) {
      return 3000 + (gNorm / rNorm) * 3000; // Tonos cálidos típicos de piel
    } else {
      return 6000 + (bNorm / gNorm) * 2000; // Evitar tonos fríos
    }
  }
  
  /**
   * Análisis ULTRA-ESTRICTO de estabilidad para detectar vibraciones vs dedo real
   */
  private calculateStabilityScore(r: number, g: number, b: number): number {
    const now = Date.now();
    
    // Agregar medición actual al historial
    this.movementHistory.push({ avgRed: r, avgGreen: g, avgBlue: b, timestamp: now });
    
    // Mantener solo mediciones MUY recientes
    if (this.movementHistory.length > this.MOVEMENT_HISTORY_SIZE) {
      this.movementHistory.shift();
    }
    
    // Necesitamos suficientes mediciones para análisis
    if (this.movementHistory.length < 4) {
      return 0.3; // Valor moderado hasta tener suficientes datos
    }
    
    // Calcular variación en los valores de color
    const recentMeasurements = this.movementHistory.slice(-6); // Usar más mediciones
    let redVariance = 0, greenVariance = 0, blueVariance = 0;
    
    const avgRed = recentMeasurements.reduce((sum, m) => sum + m.avgRed, 0) / recentMeasurements.length;
    const avgGreen = recentMeasurements.reduce((sum, m) => sum + m.avgGreen, 0) / recentMeasurements.length;
    const avgBlue = recentMeasurements.reduce((sum, m) => sum + m.avgBlue, 0) / recentMeasurements.length;
    
    recentMeasurements.forEach(m => {
      redVariance += Math.pow(m.avgRed - avgRed, 2);
      greenVariance += Math.pow(m.avgGreen - avgGreen, 2);
      blueVariance += Math.pow(m.avgBlue - avgBlue, 2);
    });
    
    const totalVariance = (redVariance + greenVariance + blueVariance) / (recentMeasurements.length * 3);
    
    // CRITERIOS MÁS ESTRICTOS: 
    // - Vibraciones de mesa/pared = alta varianza artificial O muy baja varianza (superficie rígida)
    // - Dedo real = varianza natural moderada con micro-movimientos vasculares
    
    if (totalVariance > 300) { // Reducido umbral para ser más estricto
      return 0.1; // Alta varianza = probablemente vibración
    } else if (totalVariance < 20) { // Aumentado umbral mínimo
      return 0.1; // Muy baja varianza = superficie rígida sin pulso
    } else if (totalVariance >= 50 && totalVariance <= 200) {
      // Rango óptimo para dedo humano con micro-circulación
      return 0.9;
    } else {
      return Math.max(0.2, 0.6 - (Math.abs(totalVariance - 125) / 300)); // Penalización gradual
    }
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
   * Calculate quality factor - MÁS ESTRICTO para reducir falsos positivos
   */
  private getLightLevelQualityFactor(lightLevel: number): number {
    // Rango óptimo más estricto
    if (lightLevel >= 35 && lightLevel <= 75) { // Rango más estrecho
      return 1.0; // Optimal lighting
    } else if (lightLevel < 35) {
      // Too dark - penalización más fuerte
      return Math.max(0.2, lightLevel / 35); // Mínimo más bajo
    } else {
      // Too bright - penalización más fuerte  
      return Math.max(0.2, 1.0 - (lightLevel - 75) / 50); // Límites más estrictos
    }
  }
  
  detectROI(redValue: number, imageData: ImageData): ProcessedSignal['roi'] {
    console.log('[DEBUG] FrameProcessor detectROI - redValue:', redValue, 'imageSize:', imageData.width+'x'+imageData.height);
    // Centered ROI by default with adaptive size
    const centerX = Math.floor(imageData.width / 2);
    const centerY = Math.floor(imageData.height / 2);
    
    // Factor ROI adaptativo mejorado
    let adaptiveROISizeFactor = this.CONFIG.ROI_SIZE_FACTOR;
    
    // Ajustar ROI basado en valor rojo - MÁS ESTRICTO
    if (redValue < 35) { // Umbral aumentado para ser más estricto
      // Señal débil - pero no aumentar tanto el ROI para evitar ruido
      adaptiveROISizeFactor = Math.min(0.7, adaptiveROISizeFactor * 1.05); // Menor aumento
    } else if (redValue > 100) { // Umbral reducido
      // Señal fuerte - enfocar más el ROI
      adaptiveROISizeFactor = Math.max(0.3, adaptiveROISizeFactor * 0.95); // Mayor reducción
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
