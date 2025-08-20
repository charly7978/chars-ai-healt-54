
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

export interface SignalValidationInput {
  value: number;
  timestamp: number;
  quality: number;
}

export interface SignalValidationResult {
  isValid: boolean;
  score: number;
  reason?: string;
}

/**
 * Validador Biofísico.
 * Evalúa la calidad de la señal PPG basándose en criterios fisiológicos.
 */
export class BiophysicalValidator {
  // Umbrales para la pulsatilidad - MÁS ESTRICTOS para reducir falsos positivos
  private readonly MIN_PULSATILITY_THRESHOLD = 0.15; // AUMENTADO para filtrar ruido
  private readonly PULSATILITY_NORMALIZATION_FACTOR = 25.0; // Aumentado para ser más conservador

  // Rangos fisiológicos MÁS ESTRICTOS
  private readonly PHYSIOLOGICAL_RANGES = {
    // Ratio Rojo/Verde: más estricto para validación real
    redToGreen: { min: 1.2, max: 3.0 }, // Rango más estrecho
    // Ratio Rojo/Azul: más conservador
    redToBlue: { min: 1.1, max: 3.5 }, // Rango más estrecho
    // Intensidad del canal rojo: umbrales más altos
    redValue: { min: 35, max: 220 }, // Mínimo más alto, máximo más bajo
  };

  // Buffer para validación temporal
  private signalBuffer: number[] = [];
  private readonly BUFFER_SIZE = 10;

  /**
   * Valida una señal PPG individual basándose en criterios biofísicos
   */
  public validateSignal(input: SignalValidationInput): SignalValidationResult {
    // Agregar al buffer para análisis temporal
    this.signalBuffer.push(input.value);
    if (this.signalBuffer.length > this.BUFFER_SIZE) {
      this.signalBuffer.shift();
    }

    // Validaciones básicas
    if (input.quality < 30) {
      return {
        isValid: false,
        score: 0,
        reason: 'Calidad de señal insuficiente'
      };
    }

    // Validar rango fisiológico del valor
    if (Math.abs(input.value) < 0.01) {
      return {
        isValid: false,
        score: 0,
        reason: 'Amplitud de señal demasiado baja'
      };
    }

    // Si tenemos suficientes muestras, validar pulsatilidad
    let pulsatilityScore = 0;
    if (this.signalBuffer.length >= 5) {
      pulsatilityScore = this.getPulsatilityScore(this.signalBuffer);
    }

    // Calcular puntuación combinada
    const qualityScore = Math.min(1, input.quality / 100);
    const amplitudeScore = Math.min(1, Math.abs(input.value) / 10);
    
    const totalScore = (qualityScore * 0.4 + amplitudeScore * 0.3 + pulsatilityScore * 0.3);
    
    const isValid = totalScore > 0.3 && pulsatilityScore > 0.1;

    return {
      isValid,
      score: totalScore,
      reason: isValid ? undefined : 'Señal no cumple criterios biofísicos'
    };
  }

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
    this.signalBuffer = [];
  }
}
