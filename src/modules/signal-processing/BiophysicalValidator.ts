/**
 * @file BiophysicalValidator.ts
 * @description Valida si una señal PPG se adhiere a características fisiológicas conocidas.
 * Comprueba la pulsatilidad, los rangos de color y la plausibilidad general de la señal.
 * PROHIBIDA LA SIMULACIÓN Y TODO TIPO DE MANIPULACIÓN FORZADA DE DATOS.
 */

export interface ColorRatios {
  red: number;
  green: number;
  blue: number;
}

/**
 * Validador Biofísico.
 * Evalúa la calidad de la señal PPG basándose en criterios fisiológicos.
 */
export class BiophysicalValidator {
  // Umbrales más estrictos para la pulsatilidad de la señal
  private readonly MIN_PULSATILITY_THRESHOLD = 0.25; // Aumentado para ser más exigente
  private readonly PULSATILITY_NORMALIZATION_FACTOR = 15.0; // Ajustado para normalización más precisa

  // Rangos fisiológicos más estrictos para detección de piel humana
  private readonly PHYSIOLOGICAL_RANGES = {
    // Rangos más estrechos para piel humana real
    redToGreen: { min: 1.3, max: 2.8 },  // Rango más estricto para piel humana
    redToBlue: { min: 1.2, max: 3.5 },   // Ajustado para piel humana
    redValue: { min: 35, max: 220 },     // Rango ajustado para evitar ruido en bajos niveles
    // Nuevos parámetros para validación adicional
    minGreenValue: 10,  // Valor mínimo de verde para evitar detección en rojo puro
    minBlueValue: 5,    // Valor mínimo de azul para validar que es color real
    maxSaturation: 0.9  // Máxima saturación permitida (evita colores puros no naturales)
  };
  
  // Historial para validación de estabilidad
  private lastScores: number[] = [];
  private readonly MAX_SCORE_HISTORY = 5; // Tamaño del historial para validación

  /**
   * Calcula un puntaje de pulsatilidad, que representa la fuerza de la señal cardíaca.
   * Una señal fuerte tiene picos y valles claros.
   * @param signalChunk Un segmento de la señal PPG filtrada.
   * @returns Un puntaje de 0.0 (no pulsátil) a 1.0 (muy pulsátil).
   */
  public getPulsatilityScore(signalChunk: number[]): number {
    if (signalChunk.length < 10) {  // Aumentado el mínimo para mejor precisión
      return 0;
    }

    // Cálculo de la amplitud pico a pico
    const max = Math.max(...signalChunk);
    const min = Math.min(...signalChunk);
    const amplitude = max - min;
    
    // Cálculo de la desviación estándar para validar variabilidad
    const mean = signalChunk.reduce((a, b) => a + b) / signalChunk.length;
    const squareDiffs = signalChunk.map(value => Math.pow(value - mean, 2));
    const avgSquareDiff = squareDiffs.reduce((a, b) => a + b) / signalChunk.length;
    const stdDev = Math.sqrt(avgSquareDiff);
    
    // La señal debe tener suficiente variabilidad para ser considerada un pulso
    if (stdDev < 0.5) {  // Umbral mínimo de desviación estándar
      return 0;
    }

    // Normalización más inteligente que considera la relación señal/ruido
    const noiseLevel = stdDev / (mean > 0 ? mean : 1);
    const snr = amplitude / (noiseLevel > 0 ? noiseLevel : 1);
    
    // Puntuación basada en amplitud normalizada y relación señal/ruido
    const amplitudeScore = Math.min(1.0, amplitude / this.PULSATILITY_NORMALIZATION_FACTOR);
    const snrScore = Math.min(1.0, snr / 10);  // Normalización de SNR
    
    // Combinación ponderada de ambas métricas
    return (amplitudeScore * 0.6 + snrScore * 0.4);
  }

  /**
   * Valida si un fragmento de señal tiene la pulsatilidad mínima requerida.
   * @param signalChunk Un segmento de la señal PPG filtrada.
   * @returns `true` si la señal es biofísicamente plausible, `false` en caso contrario.
   */
  public isPulsatile(signalChunk: number[]): boolean {
    const score = this.getPulsatilityScore(signalChunk);
    return score > this.MIN_PULSATILITY_THRESHOLD;
  }

  /**
   * Valida si los ratios de color de la señal están dentro de rangos fisiológicos esperados.
   * Esto ayuda a confirmar que el sensor está viendo tejido perfundido con sangre.
   * @param ratios Los ratios de color (R, G, B) promediados del ROI.
   * @returns Un puntaje de 0.0 (no plausible) a 1.0 (muy plausible).
   */
  public getBiophysicalScore(ratios: ColorRatios): number {
    // Validaciones iniciales de valores de color
    if (ratios.green < this.PHYSIOLOGICAL_RANGES.minGreenValue || 
        ratios.blue < this.PHYSIOLOGICAL_RANGES.minBlueValue) {
      return 0;  // Rechazar si los valores de verde o azul son demasiado bajos
    }
    
    // Calcular saturación para detectar colores no naturales
    const maxColor = Math.max(ratios.red, ratios.green, ratios.blue);
    const minColor = Math.min(ratios.red, ratios.green, ratios.blue);
    const saturation = maxColor > 0 ? (maxColor - minColor) / maxColor : 0;
    
    if (saturation > this.PHYSIOLOGICAL_RANGES.maxSaturation) {
      return 0;  // Rechazar colores puros no naturales
    }
    
    const rgRatio = ratios.green > 0 ? ratios.red / ratios.green : 0;
    const rbRatio = ratios.blue > 0 ? ratios.red / ratios.blue : 0;
    
    // Puntuación para el canal rojo (forma de campana alrededor del valor óptimo)
    const redRange = this.PHYSIOLOGICAL_RANGES.redValue;
    const redMid = (redRange.min + redRange.max) / 2;
    const redRangeWidth = (redRange.max - redRange.min) / 2;
    const redScore = Math.max(0, 1 - Math.pow((ratios.red - redMid) / redRangeWidth, 2));
    
    // Puntuación para el ratio rojo/verde (forma de campana)
    const rgMid = (this.PHYSIOLOGICAL_RANGES.redToGreen.min + this.PHYSIOLOGICAL_RANGES.redToGreen.max) / 2;
    const rgRangeWidth = (this.PHYSIOLOGICAL_RANGES.redToGreen.max - this.PHYSIOLOGICAL_RANGES.redToGreen.min) / 2;
    const rgScore = Math.max(0, 1 - Math.pow((rgRatio - rgMid) / rgRangeWidth, 2));
    
    // Puntuación para el ratio rojo/azul (forma de campana)
    const rbMid = (this.PHYSIOLOGICAL_RANGES.redToBlue.min + this.PHYSIOLOGICAL_RANGES.redToBlue.max) / 2;
    const rbRangeWidth = (this.PHYSIOLOGICAL_RANGES.redToBlue.max - this.PHYSIOLOGICAL_RANGES.redToBlue.min) / 2;
    const rbScore = Math.max(0, 1 - Math.pow((rbRatio - rbMid) / rbRangeWidth, 2));
    
    // Ponderación de las puntuaciones
    const totalWeight = 3; // redScore + rgScore + rbScore
    let finalScore = (redScore * 0.4 + rgScore * 0.4 + rbScore * 0.2);
    
    // Validación de estabilidad en el tiempo
    this.lastScores.push(finalScore);
    if (this.lastScores.length > this.MAX_SCORE_HISTORY) {
      this.lastScores.shift();
    }
    
    // Si hay suficiente historial, aplicar un factor de estabilidad
    if (this.lastScores.length === this.MAX_SCORE_HISTORY) {
      const avgScore = this.lastScores.reduce((a, b) => a + b, 0) / this.lastScores.length;
      const variance = this.lastScores.reduce((sum, score) => sum + Math.pow(score - avgScore, 2), 0) / this.lastScores.length;
      const stabilityFactor = Math.max(0, 1 - (variance * 2)); // Penalizar alta variabilidad
      finalScore *= stabilityFactor;
    }
    
    return Math.max(0, Math.min(1, finalScore));
  }

  /**
   * Reinicia el estado del validador.
   */
  public reset(): void {
    this.lastScores = [];
  }
}
