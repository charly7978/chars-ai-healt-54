/**
 * PRESSURE MODEL
 * 
 * Modelo de presión basado en evidencias observables (no fake).
 */

export interface PressureInput {
  intensityChange: number;
  clipHighRatio: number;
  clipLowRatio: number;
  pulsatilityLoss: boolean;
  areaReduction: number;
  dynamicRangeCompression: number;
  acdcDrop: number;
  baselineDrift: number;
}

export interface PressureOutput {
  pressureScore: number; // 0-1, 1 = máxima presión
  saturationScore: number; // 0-1, 1 = saturación
  isExcessivePressure: boolean;
  isInsufficientContact: boolean;
  confidence: number;
  reason: string;
}

export class PressureModel {
  private history: number[] = [];
  private maxHistory = 60;
  private baselineIntensity = 0;
  private baselineInitialized = false;

  /**
   * Estima presión basado en evidencias
   */
  estimate(input: PressureInput): PressureOutput {
    // Actualizar baseline de intensidad
    if (!this.baselineInitialized) {
      this.baselineIntensity = input.intensityChange;
      this.baselineInitialized = true;
    } else {
      this.baselineIntensity = this.baselineIntensity * 0.99 + input.intensityChange * 0.01;
    }

    let pressureScore = 0;
    let saturationScore = 0;
    const reasons: string[] = [];

    // 1. Clipping alto (peso 0.3)
    if (input.clipHighRatio > 0.1) {
      const clipScore = Math.min(1, input.clipHighRatio * 3);
      pressureScore += clipScore * 0.3;
      saturationScore += clipScore * 0.4;
      if (input.clipHighRatio > 0.25) {
        reasons.push('Clipping alto');
      }
    }

    // 2. Pérdida de pulsatilidad con blob presente (peso 0.25)
    if (input.pulsatilityLoss) {
      pressureScore += 0.25;
      reasons.push('Pérdida de pulsatilidad');
    }

    // 3. Reducción de área efectiva (peso 0.15)
    if (input.areaReduction > 0.2) {
      const areaScore = Math.min(1, input.areaReduction * 2);
      pressureScore += areaScore * 0.15;
      if (input.areaReduction > 0.4) {
        reasons.push('Área reducida');
      }
    }

    // 4. Compresión de rango dinámico (peso 0.15)
    if (input.dynamicRangeCompression > 0.3) {
      const rangeScore = Math.min(1, input.dynamicRangeCompression * 2);
      pressureScore += rangeScore * 0.15;
      reasons.push('Rango dinámico comprimido');
    }

    // 5. Caída de AC/DC (peso 0.1)
    if (input.acdcDrop > 0.5) {
      const acdcScore = Math.min(1, input.acdcDrop);
      pressureScore += acdcScore * 0.1;
      reasons.push('AC/DC reducido');
    }

    // 6. Drift de baseline (peso 0.05)
    if (input.baselineDrift > 0.1) {
      const driftScore = Math.min(1, input.baselineDrift * 5);
      pressureScore += driftScore * 0.05;
    }

    // Agregar al historial para suavizado
    this.history.push(pressureScore);
    if (this.history.length > this.maxHistory) {
      this.history.shift();
    }

    // Suavizar con media móvil
    const smoothedPressure = this.history.length > 5
      ? this.history.slice(-10).reduce((a, b) => a + b, 0) / Math.min(10, this.history.length)
      : pressureScore;

    // Determinar estados
    const isExcessivePressure = smoothedPressure > 0.7;
    const isInsufficientContact = input.clipLowRatio > 0.3 && smoothedPressure < 0.2;

    // Confianza basada en consistencia
    const confidence = this.history.length > 10
      ? 1 - (Math.max(...this.history) - Math.min(...this.history))
      : 0.5;

    return {
      pressureScore: smoothedPressure,
      saturationScore,
      isExcessivePressure,
      isInsufficientContact,
      confidence: Math.max(0, Math.min(1, confidence)),
      reason: reasons.length > 0 ? reasons.join(', ') : 'Presión normal'
    };
  }

  /**
   * Calcula cambio de intensidad relativo al baseline
   */
  computeIntensityChange(currentIntensity: number): number {
    if (!this.baselineInitialized) return 0;
    return (currentIntensity - this.baselineIntensity) / (this.baselineIntensity + 1e-6);
  }

  /**
   * Detecta pérdida de pulsatilidad
   */
  detectPulsatilityLoss(acdc: number, threshold: number = 0.002): boolean {
    return acdc < threshold;
  }

  /**
   * Calcula reducción de área
   */
  computeAreaReduction(currentArea: number, referenceArea: number): number {
    if (referenceArea === 0) return 0;
    return Math.max(0, (referenceArea - currentArea) / referenceArea);
  }

  /**
   * Calcula compresión de rango dinámico
   */
  computeDynamicRangeCompression(currentRange: number, referenceRange: number): number {
    if (referenceRange === 0) return 0;
    return Math.max(0, (referenceRange - currentRange) / referenceRange);
  }

  /**
   * Calcula caída de AC/DC
   */
  computeACDCDrop(currentACDC: number, referenceACDC: number): number {
    if (referenceACDC === 0) return 0;
    return Math.max(0, (referenceACDC - currentACDC) / referenceACDC);
  }

  /**
   * Resetea el modelo
   */
  reset(): void {
    this.history = [];
    this.baselineIntensity = 0;
    this.baselineInitialized = false;
  }

  /**
   * Obtiene presión actual suavizada
   */
  getCurrentPressure(): number {
    if (this.history.length === 0) return 0;
    return this.history[this.history.length - 1];
  }
}
