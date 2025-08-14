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
  // Umbrales para la pulsatilidad de la señal.
  private readonly MIN_PULSATILITY_THRESHOLD = 0.05; // Umbral mínimo de pulsatilidad reducido
  private readonly PULSATILITY_NORMALIZATION_FACTOR = 10.0; // Factor reducido para mayor sensibilidad

  // Rangos fisiológicos esperados para los ratios de color y la intensidad - más permisivos.
  private readonly PHYSIOLOGICAL_RANGES = {
    // Ratio Rojo/Verde: la sangre absorbe más verde que rojo.
    redToGreen: { min: 0.5, max: 6.0 }, // Rango ampliado
    // Ratio Rojo/Azul: similar al anterior, pero menos distintivo.
    redToBlue: { min: 0.5, max: 8.0 }, // Rango ampliado
    // Intensidad del canal rojo: debe estar en un rango detectable, ni saturado ni muy oscuro.
    redValue: { min: 10, max: 250 }, // Rango ampliado
  };

  /**
   * Calcula un puntaje de pulsatilidad, que representa la fuerza de la señal cardíaca.
   * Una señal fuerte tiene picos y valles claros.
   * @param signalChunk Un segmento de la señal PPG filtrada.
   * @returns Un puntaje de 0.0 (no pulsátil) a 1.0 (muy pulsátil).
   */
  public getPulsatilityScore(signalChunk: number[]): number {
    if (signalChunk.length < 5) {
      return 0;
    }

    const max = Math.max(...signalChunk);
    const min = Math.min(...signalChunk);
    const amplitude = max - min;

    // Normaliza el puntaje basado en una amplitud esperada para un pulso fuerte.
    const score = Math.min(1.0, amplitude / this.PULSATILITY_NORMALIZATION_FACTOR);

    return score;
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
