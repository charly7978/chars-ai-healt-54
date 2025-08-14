/**
 * Procesador de señales PPG de múltiples cámaras
 * Combina y optimiza señales para máxima precisión en detección de latidos
 */

interface PPGSignalData {
  cameraId: string;
  timestamp: number;
  redChannel: number;
  greenChannel: number;
  irChannel: number;
  quality: number;
}

interface CombinedSignal {
  timestamp: number;
  redValue: number;
  greenValue: number;
  irValue: number;
  combinedQuality: number;
  activeCameras: number;
}

export class MultiSignalProcessor {
  private signalHistory: Map<string, PPGSignalData[]> = new Map();
  private readonly HISTORY_SIZE = 30;
  private readonly MIN_QUALITY_THRESHOLD = 30;
  private onProcessedSignal: ((signal: CombinedSignal) => void) | null = null;

  constructor() {
    console.log('MultiSignalProcessor: Inicializando procesador de múltiples señales');
  }

  /**
   * Configura el callback para señales procesadas
   */
  setSignalCallback(callback: (signal: CombinedSignal) => void): void {
    this.onProcessedSignal = callback;
  }

  /**
   * Procesa señales de múltiples cámaras y las combina
   */
  processMultiCameraSignals(signals: PPGSignalData[]): void {
    if (signals.length === 0) return;

    // Actualizar historial de cada cámara
    for (const signal of signals) {
      this.updateSignalHistory(signal);
    }

    // Filtrar señales de calidad suficiente
    const qualitySignals = signals.filter(s => s.quality >= this.MIN_QUALITY_THRESHOLD);
    
    if (qualitySignals.length === 0) {
      console.warn('Ninguna cámara tiene calidad suficiente para PPG');
      return;
    }

    // Combinar señales usando diferentes estrategias
    const combinedSignal = this.combineSignals(qualitySignals);
    
    // Enviar señal combinada al procesador
    if (this.onProcessedSignal && combinedSignal) {
      this.onProcessedSignal(combinedSignal);
    }
  }

  /**
   * Actualiza el historial de señales para una cámara
   */
  private updateSignalHistory(signal: PPGSignalData): void {
    if (!this.signalHistory.has(signal.cameraId)) {
      this.signalHistory.set(signal.cameraId, []);
    }

    const history = this.signalHistory.get(signal.cameraId)!;
    history.push(signal);

    if (history.length > this.HISTORY_SIZE) {
      history.shift();
    }
  }

  /**
   * Combina señales de múltiples cámaras usando diferentes estrategias
   */
  private combineSignals(signals: PPGSignalData[]): CombinedSignal | null {
    if (signals.length === 0) return null;

    const timestamp = Date.now();
    
    // Estrategia 1: Promedio ponderado por calidad
    const weightedAverage = this.calculateWeightedAverage(signals);
    
    // Estrategia 2: Selección de mejor cámara
    const bestCamera = this.selectBestCamera(signals);
    
    // Estrategia 3: Fusión adaptativa
    const adaptiveFusion = this.adaptiveFusion(signals, weightedAverage, bestCamera);

    return {
      timestamp,
      redValue: adaptiveFusion.red,
      greenValue: adaptiveFusion.green,
      irValue: adaptiveFusion.ir,
      combinedQuality: adaptiveFusion.quality,
      activeCameras: signals.length
    };
  }

  /**
   * Calcula promedio ponderado por calidad de señal
   */
  private calculateWeightedAverage(signals: PPGSignalData[]): {
    red: number; green: number; ir: number; quality: number;
  } {
    let totalWeight = 0;
    let weightedRed = 0;
    let weightedGreen = 0;
    let weightedIr = 0;

    for (const signal of signals) {
      const weight = Math.pow(signal.quality / 100, 2); // Peso cuadrático por calidad
      totalWeight += weight;
      weightedRed += signal.redChannel * weight;
      weightedGreen += signal.greenChannel * weight;
      weightedIr += signal.irChannel * weight;
    }

    if (totalWeight === 0) {
      return { red: 0, green: 0, ir: 0, quality: 0 };
    }

    return {
      red: weightedRed / totalWeight,
      green: weightedGreen / totalWeight,
      ir: weightedIr / totalWeight,
      quality: Math.min(100, totalWeight * 50) // Calidad combinada
    };
  }

  /**
   * Selecciona la mejor cámara basada en calidad y estabilidad
   */
  private selectBestCamera(signals: PPGSignalData[]): {
    red: number; green: number; ir: number; quality: number;
  } {
    let bestSignal = signals[0];
    let bestScore = 0;

    for (const signal of signals) {
      // Calcular score basado en calidad y estabilidad histórica
      const stability = this.calculateStability(signal.cameraId);
      const score = signal.quality * 0.7 + stability * 0.3;

      if (score > bestScore) {
        bestScore = score;
        bestSignal = signal;
      }
    }

    return {
      red: bestSignal.redChannel,
      green: bestSignal.greenChannel,
      ir: bestSignal.irChannel,
      quality: bestSignal.quality
    };
  }

  /**
   * Calcula la estabilidad de una cámara basada en su historial
   */
  private calculateStability(cameraId: string): number {
    const history = this.signalHistory.get(cameraId);
    if (!history || history.length < 5) return 0;

    // Calcular varianza de la calidad en el historial reciente
    const recentQualities = history.slice(-10).map(s => s.quality);
    const avgQuality = recentQualities.reduce((a, b) => a + b, 0) / recentQualities.length;
    
    const variance = recentQualities.reduce((acc, q) => acc + Math.pow(q - avgQuality, 2), 0) / recentQualities.length;
    const stability = Math.max(0, 100 - Math.sqrt(variance));

    return stability;
  }

  /**
   * Fusión adaptativa que combina las mejores características de cada estrategia
   */
  private adaptiveFusion(
    signals: PPGSignalData[],
    weightedAvg: { red: number; green: number; ir: number; quality: number },
    bestCamera: { red: number; green: number; ir: number; quality: number }
  ): { red: number; green: number; ir: number; quality: number } {
    
    // Factor de confianza basado en número de cámaras y calidad promedio
    const avgQuality = signals.reduce((sum, s) => sum + s.quality, 0) / signals.length;
    const cameraCountFactor = Math.min(1, signals.length / 3); // Óptimo con 3+ cámaras
    const confidenceFactor = (avgQuality / 100) * cameraCountFactor;

    // Mezclar estrategias basado en confianza
    const blendFactor = confidenceFactor; // 0 = solo mejor cámara, 1 = solo promedio ponderado

    return {
      red: bestCamera.red * (1 - blendFactor) + weightedAvg.red * blendFactor,
      green: bestCamera.green * (1 - blendFactor) + weightedAvg.green * blendFactor,
      ir: bestCamera.ir * (1 - blendFactor) + weightedAvg.ir * blendFactor,
      quality: Math.max(bestCamera.quality, weightedAvg.quality * confidenceFactor)
    };
  }

  /**
   * Obtiene estadísticas del procesador
   */
  getProcessorStats(): {
    activeCameras: number;
    avgQuality: number;
    bestCameraId: string | null;
    totalSignalsProcessed: number;
  } {
    const activeCameras = this.signalHistory.size;
    let totalQuality = 0;
    let totalSignals = 0;
    let bestCameraId: string | null = null;
    let bestAvgQuality = 0;

    for (const [cameraId, history] of this.signalHistory) {
      if (history.length > 0) {
        const avgQuality = history.reduce((sum, s) => sum + s.quality, 0) / history.length;
        totalQuality += avgQuality;
        totalSignals += history.length;

        if (avgQuality > bestAvgQuality) {
          bestAvgQuality = avgQuality;
          bestCameraId = cameraId;
        }
      }
    }

    return {
      activeCameras,
      avgQuality: activeCameras > 0 ? totalQuality / activeCameras : 0,
      bestCameraId,
      totalSignalsProcessed: totalSignals
    };
  }

  /**
   * Limpia el historial de señales
   */
  clearHistory(): void {
    this.signalHistory.clear();
    console.log('MultiSignalProcessor: Historial de señales limpiado');
  }

  /**
   * Obtiene la calidad promedio de todas las cámaras activas
   */
  getCurrentQuality(): number {
    if (this.signalHistory.size === 0) return 0;

    let totalQuality = 0;
    let cameraCount = 0;

    for (const [_, history] of this.signalHistory) {
      if (history.length > 0) {
        const latestSignal = history[history.length - 1];
        totalQuality += latestSignal.quality;
        cameraCount++;
      }
    }

    return cameraCount > 0 ? totalQuality / cameraCount : 0;
  }
}