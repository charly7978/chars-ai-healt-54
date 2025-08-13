/**
 * MotionDetector - Sistema avanzado para detectar movimiento del dedo
 * y validar que esté realmente estático para medición PPG
 * PROHIBIDA LA SIMULACIÓN Y TODO TIPO DE MANIPULACIÓN FORZADA DE DATOS
 */

export interface MotionAnalysis {
  isStatic: boolean;
  motionLevel: number; // 0-1, donde 0 = completamente estático
  stabilityScore: number; // 0-1, donde 1 = máxima estabilidad
  hasValidPlacement: boolean;
}

export class MotionDetector {
  private frameHistory: Array<{
    redValue: number;
    roiX: number;
    roiY: number;
    timestamp: number;
    textureScore: number;
  }> = [];
  
  private readonly HISTORY_SIZE = 20;
  private readonly MOTION_THRESHOLD = 0.4; // Umbral PERMISIVO para movimiento
  private readonly STABILITY_WINDOW = 10;
  private readonly MIN_STATIC_FRAMES = 4; // Mínimo frames estáticos REDUCIDO
  
  analyzeMotion(
    redValue: number,
    roi: { x: number; y: number; width: number; height: number },
    textureScore: number
  ): MotionAnalysis {
    const currentFrame = {
      redValue,
      roiX: roi.x,
      roiY: roi.y,
      timestamp: Date.now(),
      textureScore
    };
    
    // Agregar frame actual al historial
    this.frameHistory.push(currentFrame);
    if (this.frameHistory.length > this.HISTORY_SIZE) {
      this.frameHistory.shift();
    }
    
    // Necesitamos suficiente historial para análisis
    if (this.frameHistory.length < this.MIN_STATIC_FRAMES) {
      return {
        isStatic: false,
        motionLevel: 1.0,
        stabilityScore: 0,
        hasValidPlacement: false
      };
    }
    
    // Analizar movimiento en múltiples dimensiones
    const motionMetrics = this.calculateMotionMetrics();
    const stabilityMetrics = this.calculateStabilityMetrics();
    const placementMetrics = this.calculatePlacementMetrics();
    
    // Determinar si el dedo está estático
    const isStatic = motionMetrics.overallMotion < this.MOTION_THRESHOLD &&
                     stabilityMetrics.isStable &&
                     placementMetrics.isWellPlaced;
    
    return {
      isStatic,
      motionLevel: motionMetrics.overallMotion,
      stabilityScore: stabilityMetrics.score,
      hasValidPlacement: placementMetrics.isWellPlaced
    };
  }
  
  private calculateMotionMetrics() {
    const recentFrames = this.frameHistory.slice(-this.STABILITY_WINDOW);
    
    // Calcular variación en posición ROI
    const roiXVariance = this.calculateVariance(recentFrames.map(f => f.roiX));
    const roiYVariance = this.calculateVariance(recentFrames.map(f => f.roiY));
    
    // Calcular variación en intensidad de señal
    const signalVariance = this.calculateVariance(recentFrames.map(f => f.redValue));
    
    // Calcular variación en textura
    const textureVariance = this.calculateVariance(recentFrames.map(f => f.textureScore));
    
    // Normalizar varianzas a escala 0-1
    const normalizedRoiMotion = Math.min(1, (roiXVariance + roiYVariance) / 100);
    const normalizedSignalMotion = Math.min(1, signalVariance / 1000);
    const normalizedTextureMotion = Math.min(1, textureVariance / 0.1);
    
    // Combinar métricas de movimiento
    const overallMotion = (normalizedRoiMotion * 0.4 + 
                          normalizedSignalMotion * 0.4 + 
                          normalizedTextureMotion * 0.2);
    
    return {
      overallMotion,
      roiMotion: normalizedRoiMotion,
      signalMotion: normalizedSignalMotion,
      textureMotion: normalizedTextureMotion
    };
  }
  
  private calculateStabilityMetrics() {
    const recentFrames = this.frameHistory.slice(-this.STABILITY_WINDOW);
    
    // Contar frames consecutivos con baja variación
    let stableFrameCount = 0;
    let maxStableSequence = 0;
    let currentSequence = 0;
    
    for (let i = 1; i < recentFrames.length; i++) {
      const prev = recentFrames[i - 1];
      const curr = recentFrames[i];
      
      // Verificar estabilidad en múltiples métricas
      const roiStable = Math.abs(curr.roiX - prev.roiX) < 5 && 
                       Math.abs(curr.roiY - prev.roiY) < 5;
      const signalStable = Math.abs(curr.redValue - prev.redValue) < 10;
      const textureStable = Math.abs(curr.textureScore - prev.textureScore) < 0.05;
      
      if (roiStable && signalStable && textureStable) {
        stableFrameCount++;
        currentSequence++;
        maxStableSequence = Math.max(maxStableSequence, currentSequence);
      } else {
        currentSequence = 0;
      }
    }
    
    const stabilityRatio = stableFrameCount / Math.max(1, recentFrames.length - 1);
    const isStable = stabilityRatio > 0.7 && maxStableSequence >= this.MIN_STATIC_FRAMES;
    
    return {
      isStable,
      score: stabilityRatio,
      maxStableSequence,
      stableFrameCount
    };
  }
  
  private calculatePlacementMetrics() {
    const recentFrames = this.frameHistory.slice(-5); // Últimos 5 frames
    
    // Verificar que el ROI esté en posición central y estable
    const avgRoiX = recentFrames.reduce((sum, f) => sum + f.roiX, 0) / recentFrames.length;
    const avgRoiY = recentFrames.reduce((sum, f) => sum + f.roiY, 0) / recentFrames.length;
    
    // Verificar que la señal tenga intensidad adecuada y consistente
    const avgSignal = recentFrames.reduce((sum, f) => sum + f.redValue, 0) / recentFrames.length;
    const signalConsistency = 1 - this.calculateVariance(recentFrames.map(f => f.redValue)) / Math.max(1, avgSignal);
    
    // Verificar que la textura sea consistente (indica dedo real)
    const avgTexture = recentFrames.reduce((sum, f) => sum + f.textureScore, 0) / recentFrames.length;
    
    // Criterios PERMISIVOS para colocación válida
    const hasAdequateSignal = avgSignal > 15 && avgSignal < 220;
    const hasConsistentSignal = signalConsistency > 0.6;
    const hasValidTexture = avgTexture > 0.1 && avgTexture < 0.95;
    
    const isWellPlaced = hasAdequateSignal && hasConsistentSignal && hasValidTexture;
    
    return {
      isWellPlaced,
      signalLevel: avgSignal,
      signalConsistency,
      textureLevel: avgTexture
    };
  }
  
  private calculateVariance(values: number[]): number {
    if (values.length < 2) return 0;
    
    const mean = values.reduce((sum, val) => sum + val, 0) / values.length;
    const squaredDiffs = values.map(val => Math.pow(val - mean, 2));
    return squaredDiffs.reduce((sum, diff) => sum + diff, 0) / values.length;
  }
  
  reset(): void {
    this.frameHistory = [];
  }
  
  getMotionHistory(): Array<{timestamp: number, motionLevel: number}> {
    return this.frameHistory.map(frame => ({
      timestamp: frame.timestamp,
      motionLevel: this.calculateFrameMotion(frame)
    }));
  }
  
  private calculateFrameMotion(frame: typeof this.frameHistory[0]): number {
    if (this.frameHistory.length < 2) return 1.0;
    
    const prevFrame = this.frameHistory[this.frameHistory.indexOf(frame) - 1];
    if (!prevFrame) return 1.0;
    
    const roiMotion = Math.abs(frame.roiX - prevFrame.roiX) + Math.abs(frame.roiY - prevFrame.roiY);
    const signalMotion = Math.abs(frame.redValue - prevFrame.redValue);
    
    return Math.min(1, (roiMotion / 10 + signalMotion / 20) / 2);
  }
}