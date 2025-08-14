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
  // Umbrales ultra-sensibles para pulsatilidad
  private readonly MIN_PULSATILITY_THRESHOLD = 0.02; // Umbral mínimo muy reducido
  private readonly PULSATILITY_NORMALIZATION_FACTOR = 6.0; // Factor muy reducido para máxima sensibilidad

  // Rangos fisiológicos ultra-permisivos para máxima detección
  private readonly PHYSIOLOGICAL_RANGES = {
    // Ratio Rojo/Verde: rango muy amplio
    redToGreen: { min: 0.2, max: 12.0 }, // Rango extremadamente ampliado
    // Ratio Rojo/Azul: rango muy amplio
    redToBlue: { min: 0.2, max: 15.0 }, // Rango extremadamente ampliado
    // Intensidad del canal rojo: acepta casi cualquier valor
    redValue: { min: 1, max: 254 }, // Rango casi completo
  };

  /**
   * Calcula un puntaje de pulsatilidad, que representa la fuerza de la señal cardíaca.
   * Una señal fuerte tiene picos y valles claros.
   * @param signalChunk Un segmento de la señal PPG filtrada.
   * @returns Un puntaje de 0.0 (no pulsátil) a 1.0 (muy pulsátil).
   */
  public getPulsatilityScore(signalChunk: number[]): number {
    if (signalChunk.length < 3) { // Reducido para detección más rápida
      return 0;
    }

    const max = Math.max(...signalChunk);
    const min = Math.min(...signalChunk);
    const amplitude = max - min;
    
    // Cálculo mejorado de pulsatilidad con múltiples métricas
    const mean = signalChunk.reduce((a, b) => a + b, 0) / signalChunk.length;
    const variance = signalChunk.reduce((acc, val) => acc + Math.pow(val - mean, 2), 0) / signalChunk.length;
    const stdDev = Math.sqrt(variance);
    
    // Combinar amplitud y varianza para mejor detección
    const amplitudeScore = Math.min(1.0, amplitude / this.PULSATILITY_NORMALIZATION_FACTOR);
    const varianceScore = Math.min(1.0, stdDev / (this.PULSATILITY_NORMALIZATION_FACTOR * 0.5));
    
    // Promedio ponderado favoreciendo la amplitud
    const score = (amplitudeScore * 0.7) + (varianceScore * 0.3);

    return Math.min(1.0, score);
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
    let score = 0;
    let totalWeight = 3;

    const rgRatio = ratios.green > 0 ? ratios.red / ratios.green : 0;
    const rbRatio = ratios.blue > 0 ? ratios.red / ratios.blue : 0;

    let redScore = 0;
    if (ratios.red >= this.PHYSIOLOGICAL_RANGES.redValue.min && ratios.red <= this.PHYSIOLOGICAL_RANGES.redValue.max) {
      redScore = 1;
    }

    let rgScore = 0;
    if (rgRatio >= this.PHYSIOLOGICAL_RANGES.redToGreen.min && rgRatio <= this.PHYSIOLOGICAL_RANGES.redToGreen.max) {
      rgScore = 1;
    }
    
    let rbScore = 0;
    if (rbRatio >= this.PHYSIOLOGICAL_RANGES.redToBlue.min && rbRatio <= this.PHYSIOLOGICAL_RANGES.redToBlue.max) {
      rbScore = 1;
    }

    score = redScore + rgScore + rbScore;

    return totalWeight > 0 ? score / totalWeight : 0;
  }

  /**
   * Reinicia el estado del validador.
   */
  public reset(): void {
    // Actualmente no hay estado que reiniciar en esta implementación, pero se mantiene por consistencia.
  }
}
