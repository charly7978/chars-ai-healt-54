/**
 * LightingValidator - Sistema para detectar condiciones de iluminación
 * y distinguir entre luz ambiental y dedo real sobre la cámara
 * PROHIBIDA LA SIMULACIÓN Y TODO TIPO DE MANIPULACIÓN FORZADA DE DATOS
 */

export interface LightingAnalysis {
  isValidForPPG: boolean;
  lightingType: 'ambient' | 'finger' | 'torch' | 'mixed' | 'insufficient';
  uniformity: number; // 0-1, donde 1 = completamente uniforme
  intensity: number; // 0-100, nivel de intensidad promedio
  hasFingerShadow: boolean; // Detecta si hay sombra característica del dedo
  confidence: number; // 0-1, confianza en la clasificación
}

export class LightingValidator {
  private lightingHistory: Array<{
    intensity: number;
    uniformity: number;
    redDominance: number;
    timestamp: number;
  }> = [];
  
  private readonly HISTORY_SIZE = 15;
  private readonly AMBIENT_LIGHT_THRESHOLD = 0.85; // Umbral para detectar luz ambiental uniforme
  private readonly FINGER_SHADOW_THRESHOLD = 0.3; // Umbral para detectar sombra del dedo
  private readonly MIN_FINGER_INTENSITY = 20; // Intensidad mínima para dedo real
  private readonly MAX_AMBIENT_INTENSITY = 180; // Intensidad máxima para luz ambiental
  
  analyzeLighting(imageData: ImageData): LightingAnalysis {
    const analysis = this.performLightingAnalysis(imageData);
    
    // Agregar al historial
    this.lightingHistory.push({
      intensity: analysis.intensity,
      uniformity: analysis.uniformity,
      redDominance: analysis.redDominance,
      timestamp: Date.now()
    });
    
    if (this.lightingHistory.length > this.HISTORY_SIZE) {
      this.lightingHistory.shift();
    }
    
    // Clasificar tipo de iluminación
    const classification = this.classifyLighting(analysis);
    
    return {
      isValidForPPG: classification.isValidForPPG,
      lightingType: classification.type,
      uniformity: analysis.uniformity,
      intensity: analysis.intensity,
      hasFingerShadow: analysis.hasFingerShadow,
      confidence: classification.confidence
    };
  }
  
  private performLightingAnalysis(imageData: ImageData) {
    const { width, height, data } = imageData;
    const pixelCount = width * height;
    
    // Dividir imagen en grid para análisis de uniformidad
    const gridSize = 8;
    const cellWidth = Math.floor(width / gridSize);
    const cellHeight = Math.floor(height / gridSize);
    const cells: Array<{r: number, g: number, b: number, intensity: number}> = [];
    
    // Analizar cada celda del grid
    for (let gridY = 0; gridY < gridSize; gridY++) {
      for (let gridX = 0; gridX < gridSize; gridX++) {
        let cellR = 0, cellG = 0, cellB = 0, cellPixels = 0;
        
        const startX = gridX * cellWidth;
        const endX = Math.min(startX + cellWidth, width);
        const startY = gridY * cellHeight;
        const endY = Math.min(startY + cellHeight, height);
        
        for (let y = startY; y < endY; y++) {
          for (let x = startX; x < endX; x++) {
            const i = (y * width + x) * 4;
            cellR += data[i];
            cellG += data[i + 1];
            cellB += data[i + 2];
            cellPixels++;
          }
        }
        
        if (cellPixels > 0) {
          const avgR = cellR / cellPixels;
          const avgG = cellG / cellPixels;
          const avgB = cellB / cellPixels;
          const intensity = (avgR + avgG + avgB) / 3;
          
          cells.push({ r: avgR, g: avgG, b: avgB, intensity });
        }
      }
    }
    
    // Calcular métricas de uniformidad
    const intensities = cells.map(cell => cell.intensity);
    const avgIntensity = intensities.reduce((sum, val) => sum + val, 0) / intensities.length;
    const intensityVariance = this.calculateVariance(intensities);
    const uniformity = Math.max(0, 1 - (intensityVariance / Math.max(1, avgIntensity * avgIntensity)));
    
    // Calcular dominancia del canal rojo (característica del dedo)
    const redValues = cells.map(cell => cell.r);
    const greenValues = cells.map(cell => cell.g);
    const avgRed = redValues.reduce((sum, val) => sum + val, 0) / redValues.length;
    const avgGreen = greenValues.reduce((sum, val) => sum + val, 0) / greenValues.length;
    const redDominance = avgGreen > 5 ? avgRed / avgGreen : 1;
    
    // Detectar sombra característica del dedo
    const hasFingerShadow = this.detectFingerShadow(cells, gridSize);
    
    // Analizar gradientes (bordes)
    const edgeStrength = this.calculateEdgeStrength(cells, gridSize);
    
    return {
      intensity: avgIntensity,
      uniformity,
      redDominance,
      hasFingerShadow,
      edgeStrength,
      cellCount: cells.length
    };
  }
  
  private detectFingerShadow(cells: Array<{intensity: number}>, gridSize: number): boolean {
    // Buscar patrón de sombra circular/elíptica característica del dedo
    const centerX = Math.floor(gridSize / 2);
    const centerY = Math.floor(gridSize / 2);
    
    let centerIntensity = 0;
    let edgeIntensity = 0;
    let centerCount = 0;
    let edgeCount = 0;
    
    for (let y = 0; y < gridSize; y++) {
      for (let x = 0; x < gridSize; x++) {
        const cellIndex = y * gridSize + x;
        if (cellIndex >= cells.length) continue;
        
        const distanceFromCenter = Math.sqrt(
          Math.pow(x - centerX, 2) + Math.pow(y - centerY, 2)
        );
        
        if (distanceFromCenter <= 1.5) {
          // Células centrales
          centerIntensity += cells[cellIndex].intensity;
          centerCount++;
        } else if (distanceFromCenter >= 2.5) {
          // Células del borde
          edgeIntensity += cells[cellIndex].intensity;
          edgeCount++;
        }
      }
    }
    
    if (centerCount === 0 || edgeCount === 0) return false;
    
    const avgCenterIntensity = centerIntensity / centerCount;
    const avgEdgeIntensity = edgeIntensity / edgeCount;
    
    // El dedo debería crear una sombra (centro más oscuro que bordes)
    const shadowRatio = avgEdgeIntensity > 0 ? avgCenterIntensity / avgEdgeIntensity : 1;
    
    return shadowRatio < this.FINGER_SHADOW_THRESHOLD;
  }
  
  private calculateEdgeStrength(cells: Array<{intensity: number}>, gridSize: number): number {
    let totalEdgeStrength = 0;
    let edgeCount = 0;
    
    for (let y = 1; y < gridSize - 1; y++) {
      for (let x = 1; x < gridSize - 1; x++) {
        const centerIndex = y * gridSize + x;
        if (centerIndex >= cells.length) continue;
        
        const center = cells[centerIndex].intensity;
        
        // Calcular gradiente con células adyacentes
        const neighbors = [
          cells[(y-1) * gridSize + x]?.intensity || 0,     // arriba
          cells[(y+1) * gridSize + x]?.intensity || 0,     // abajo
          cells[y * gridSize + (x-1)]?.intensity || 0,     // izquierda
          cells[y * gridSize + (x+1)]?.intensity || 0      // derecha
        ];
        
        const gradientSum = neighbors.reduce((sum, neighbor) => 
          sum + Math.abs(center - neighbor), 0
        );
        
        totalEdgeStrength += gradientSum;
        edgeCount++;
      }
    }
    
    return edgeCount > 0 ? totalEdgeStrength / edgeCount : 0;
  }
  
  private classifyLighting(analysis: any): {
    type: LightingAnalysis['lightingType'];
    isValidForPPG: boolean;
    confidence: number;
  } {
    const { intensity, uniformity, redDominance, hasFingerShadow, edgeStrength } = analysis;
    
    // Clasificación basada en múltiples criterios
    let type: LightingAnalysis['lightingType'] = 'insufficient';
    let confidence = 0;
    let isValidForPPG = false;
    
    // Luz ambiental: alta uniformidad, baja dominancia roja, sin sombra
    if (uniformity > this.AMBIENT_LIGHT_THRESHOLD && 
        redDominance < 1.3 && 
        !hasFingerShadow &&
        intensity > 30 && intensity < this.MAX_AMBIENT_INTENSITY) {
      type = 'ambient';
      confidence = uniformity * 0.8;
      isValidForPPG = false;
    }
    
    // Dedo real: dominancia roja, sombra característica, intensidad moderada
    else if (redDominance > 1.5 && 
             hasFingerShadow && 
             intensity > this.MIN_FINGER_INTENSITY && 
             intensity < 150 &&
             edgeStrength > 10) {
      type = 'finger';
      confidence = Math.min(1, (redDominance - 1) * 0.5 + (hasFingerShadow ? 0.4 : 0) + 0.1);
      isValidForPPG = true;
    }
    
    // Linterna/flash: muy alta intensidad, dominancia roja variable
    else if (intensity > 150 && redDominance > 1.2) {
      type = 'torch';
      confidence = Math.min(1, (intensity - 150) / 100);
      isValidForPPG = hasFingerShadow; // Solo válido si también hay dedo
    }
    
    // Condiciones mixtas: combinación de factores
    else if (intensity > this.MIN_FINGER_INTENSITY && 
             (redDominance > 1.2 || hasFingerShadow)) {
      type = 'mixed';
      confidence = 0.5;
      isValidForPPG = hasFingerShadow && redDominance > 1.3;
    }
    
    // Insuficiente: muy baja intensidad
    else if (intensity < this.MIN_FINGER_INTENSITY) {
      type = 'insufficient';
      confidence = 0.9;
      isValidForPPG = false;
    }
    
    return { type, isValidForPPG, confidence };
  }
  
  private calculateVariance(values: number[]): number {
    if (values.length < 2) return 0;
    
    const mean = values.reduce((sum, val) => sum + val, 0) / values.length;
    const squaredDiffs = values.map(val => Math.pow(val - mean, 2));
    return squaredDiffs.reduce((sum, diff) => sum + diff, 0) / values.length;
  }
  
  reset(): void {
    this.lightingHistory = [];
  }
  
  getLightingTrend(): 'stable' | 'increasing' | 'decreasing' | 'fluctuating' {
    if (this.lightingHistory.length < 5) return 'stable';
    
    const recent = this.lightingHistory.slice(-5);
    const intensities = recent.map(h => h.intensity);
    
    const trend = intensities[intensities.length - 1] - intensities[0];
    const variance = this.calculateVariance(intensities);
    
    if (variance > 100) return 'fluctuating';
    if (trend > 10) return 'increasing';
    if (trend < -10) return 'decreasing';
    return 'stable';
  }
}