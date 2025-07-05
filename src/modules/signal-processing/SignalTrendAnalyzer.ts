export type TrendResult = "stable" | "unstable" | "non_physiological";

/**
 * Clase para análisis de tendencias de la señal PPG
 * Implementa detección de patrones y estabilidad
 */
export class SignalTrendAnalyzer {
  private readonly historyLength: number;
  private valueHistory: number[] = [];
  private diffHistory: number[] = [];
  private patternHistory: string[] = [];
  private trendScores: {
    stability: number;
    periodicity: number;
    consistency: number;
    physiological: number;
  } = { stability: 0, periodicity: 0, consistency: 0, physiological: 0 };

  constructor(historyLength: number = 30) {
    this.historyLength = historyLength;
  }
  analyzeTrend(value: number): TrendResult {
    // Implementar una lógica más completa basada en los scores
    const { stability, periodicity, consistency, physiological } = this.trendScores;
    
    // Si las métricas fisiológicas están fuera de rango
    if (physiological < 0.3 && this.valueHistory.length > 15) {
      return "non_physiological";
    }
    
    // Usar una combinación de métricas para determinar estabilidad
    const stabilityScore = (stability * 0.4 + periodicity * 0.3 + consistency * 0.3);
    return stabilityScore > 0.6 ? "stable" : "unstable";
  }

  getStabilityScore(): number {
    if (this.valueHistory.length < 10) return 0;
    
    // Calcular desviación estándar normalizada
    const mean = this.valueHistory.reduce((sum, val) => sum + val, 0) / this.valueHistory.length;
    const variance = this.valueHistory.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / this.valueHistory.length;
    const stdDev = Math.sqrt(variance);
    
    // Normalizar por amplitud media
    const normalizedStdDev = stdDev / Math.max(0.01, Math.abs(mean));
    
    // Score de estabilidad inversamente proporcional a la desviación
    return Math.max(0, 1 - normalizedStdDev * 2);
  }
  
  getPeriodicityScore(): number {
    if (this.diffHistory.length < 5) return 0;
    
    // Contar cambios de dirección
    let directionChanges = 0;
    for (let i = 1; i < this.diffHistory.length; i++) {
      if (Math.sign(this.diffHistory[i]) !== Math.sign(this.diffHistory[i-1])) {
        directionChanges++;
      }
    }
    
    // Normalizar por número de muestras
    const changeRate = directionChanges / this.diffHistory.length;
    
    // Score óptimo para ritmo cardíaco (2-4 cambios por segundo)
    if (changeRate >= 0.1 && changeRate <= 0.2) {
      return 1.0;
    }
    // Score decreciente fuera del rango óptimo
    return Math.max(0, 1 - Math.abs(0.15 - changeRate) * 10);
  }

  addValue(value: number): void {
    // Actualizar historiales
    this.valueHistory.push(value);
    if (this.valueHistory.length > this.historyLength) {
      this.valueHistory.shift();
    }
    
    // Calcular diferencias
    if (this.valueHistory.length >= 2) {
      const diff = value - this.valueHistory[this.valueHistory.length - 2];
      this.diffHistory.push(diff);
      if (this.diffHistory.length > this.historyLength - 1) {
        this.diffHistory.shift();
      }
      
      // Detectar dirección (subiendo/bajando)
      const pattern = diff > 0 ? "+" : (diff < 0 ? "-" : "=");
      this.patternHistory.push(pattern);
      if (this.patternHistory.length > this.historyLength - 1) {
        this.patternHistory.shift();
      }
    }
    
    // Actualizar análisis
    this.updateAnalysis();
  }

  private updateAnalysis(): void {
    if (this.valueHistory.length < 6) return; // Permitir análisis antes (antes 10)
    
    // 1. Calcular estabilidad (basada en desviación estándar normalizada)
    const mean = this.valueHistory.reduce((sum, val) => sum + val, 0) / this.valueHistory.length;
    const variance = this.valueHistory.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / this.valueHistory.length;
    const stdDev = Math.sqrt(variance);
    const normalizedStdDev = stdDev / Math.max(1, Math.abs(mean));
    // Menor penalización por ruido, estabilidad sube mucho más rápido
    this.trendScores.stability = Math.max(0, Math.min(1, 1 - normalizedStdDev * 1.1)); // Antes *2.2
    
    // 2. Calcular periodicidad (basada en cruces por cero y cambios de dirección)
    let directionChanges = 0;
    for (let i = 1; i < this.patternHistory.length; i++) {
      if (this.patternHistory[i] !== this.patternHistory[i-1]) {
        directionChanges++;
      }
    }
    
    // Normalizar cambios de dirección a valor 0-1 (óptimo: entre 8-20 para ventana de 30)
    const normalizedChanges = directionChanges / this.patternHistory.length;
    this.trendScores.periodicity = normalizedChanges < 0.2 ? normalizedChanges * 5 : 
                                 normalizedChanges > 0.6 ? Math.max(0, 1 - (normalizedChanges - 0.6) * 2.5) :
                                 1;
    
    // 3. Calcular consistencia temporal (patrones repetitivos)
    let patternScore = 0;
    if (this.patternHistory.length >= 6) {
      // Buscar patrones tipo "+-+-+-" o "-+-+-+"
      const pattern = this.patternHistory.join('');
      const alternatingPattern1 = "+-".repeat(10);
      const alternatingPattern2 = "-+".repeat(10);
      
      if (pattern.includes("+-+-+") || pattern.includes("-+-+-")) {
        patternScore += 0.6;
      }
      
      // Verificar secuencia de longitud 4
      for (let i = 0; i < this.patternHistory.length - 4; i++) {
        const subPattern = this.patternHistory.slice(i, i + 4).join('');
        if (pattern.lastIndexOf(subPattern) > i + 3) {
          patternScore += 0.4;
          break;
        }
      }
    }
    this.trendScores.consistency = Math.min(1, patternScore);
    
    // 4. Verificar si el comportamiento es fisiológicamente plausible (frecuencias en rango de pulso)
    let physiologicalScore = 0;
    if (this.valueHistory.length >= 15 && directionChanges >= 4) {
      const peaksPerSecond = directionChanges / 2 / (this.valueHistory.length / 30); // Asumir 30fps
      const equivalentBPM = peaksPerSecond * 60;
      
      // Verificar si está en el rango fisiológico (40-180 BPM)
      if (equivalentBPM >= 40 && equivalentBPM <= 180) {
        physiologicalScore = 1;
      } else if (equivalentBPM > 30 && equivalentBPM < 200) {
        // Cerca del rango fisiológico
        physiologicalScore = 0.5;
      }
    }
    this.trendScores.physiological = physiologicalScore;
  }

  getScores(): { stability: number; periodicity: number; consistency: number; physiological: number } {
    return { ...this.trendScores };
  }

  getAnalysisResult(): 'highly_stable' | 'stable' | 'moderately_stable' | 'unstable' | 'highly_unstable' | 'non_physiological' {
    const { stability, periodicity, consistency, physiological } = this.trendScores;
    const compositeScore = stability * 0.3 + periodicity * 0.3 + consistency * 0.2 + physiological * 0.2;
    
    // Reglas especiales
    if (physiological < 0.3 && this.valueHistory.length > 15) {
      return 'non_physiological';
    }
    
    if (compositeScore > 0.8) return 'highly_stable';
    if (compositeScore > 0.65) return 'stable';
    if (compositeScore > 0.45) return 'moderately_stable';
    if (compositeScore > 0.25) return 'unstable';
    return 'highly_unstable';
  }

  reset(): void {
    this.valueHistory = [];
    this.diffHistory = [];
    this.patternHistory = [];
    this.trendScores = { stability: 0, periodicity: 0, consistency: 0, physiological: 0 };
  }
}
