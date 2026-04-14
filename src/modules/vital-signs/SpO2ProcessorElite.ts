/**
 * SpO2 PROCESSOR ELITE V2 - OXIMETRÍA DE PRECISIÓN CLÍNICA
 * 
 * V2 mejoras:
 * - Curva CUADRÁTICA via SpO2Calibrator inyectable (A + B*R + C*R²)
 *   en lugar de lineal fija (110 - 25*R)
 * - Validación cruzada con canal B (absorción diferencial R/B)
 * - Umbrales de confianza más exigentes para HIGH_CONF
 * 
 * Algoritmo: Ratio-of-Ratios calibrado + compensación CHROM
 * Referencias:
 * - Webster 1997: Pulse oximetry principles
 * - De Jesus et al. 2020: Smartphone SpO2 validation
 * - CHROM algorithm: De Haan & Jeanne 2013 (motion robustness)
 */

import { trimmedMedian } from './OpticalRatioEngine';
import { SpO2Calibrator } from './SpO2Calibrator';

export interface SpO2ResultElite {
  value: number;
  confidence: number;
  quality: number;
  calibrationState: 'UNCALIBRATED' | 'SESSION_CALIBRATED' | 'FACTORY_CALIBRATED';
  enabledState: 'ENABLED_HIGH_CONF' | 'ENABLED_MEDIUM_CONF' | 'WITHHELD_LOW_QUALITY';
  opticalMetrics: {
    redAC: number;
    redDC: number;
    greenAC: number;
    greenDC: number;
    perfusionIndexRed: number;
    perfusionIndexGreen: number;
    ratioR: number;
  };
  consecutiveValidFrames: number;
  validBeatRatios: number;
  signalStability: number;
  warnings: string[];
}

export class SpO2ProcessorElite {
  // Buffer de ratios para estabilidad
  private ratioBuffer: number[] = [];
  private readonly RATIO_BUFFER_SIZE = 20;
  private ratioQualityBuffer: number[] = [];
  private beatRatioBuffer: number[] = [];
  private readonly BEAT_RATIO_BUF = 8;
  
  // Estado
  private consecutiveValidFrames = 0;
  private lastValidValue = 98;
  
  // Historial para tendencia
  private valueHistory: number[] = [];
  private readonly HISTORY_SIZE = 30;

  // ═══ V2: Calibrador inyectable (curva cuadrática por dispositivo) ═══
  private calibrator: SpO2Calibrator | null = null;
  // Fallback lineal si no hay calibrador
  private readonly FALLBACK_INTERCEPT = 110.0;
  private readonly FALLBACK_SLOPE = 25.0;

  /** Inyectar calibrador con curva cuadrática por dispositivo/sesión */
  setCalibrator(cal: SpO2Calibrator): void {
    this.calibrator = cal;
  }
  
  process(input: {
    redAC: number;
    redDC: number;
    greenAC: number;
    greenDC: number;
    contactQuality: number;
    beatSQI: number;
    pressureOptimal: boolean;
    clipHighRatio: number;
    clipLowRatio: number;
    /** V2: Canal azul opcional para validación cruzada */
    blueAC?: number;
    blueDC?: number;
  }): SpO2ResultElite {
    const warnings: string[] = [];
    
    // ========== VALIDACIÓN DE ENTRADA ==========
    if (input.redDC < 5 || input.greenDC < 5) {
      warnings.push('Insufficient DC levels');
      this.consecutiveValidFrames = 0;
      return this.getWithheldResult(warnings);
    }
    
    if (input.redAC < 0.01 || input.greenAC < 0.01) {
      warnings.push('Insufficient AC amplitude');
      this.consecutiveValidFrames = 0;
      return this.getWithheldResult(warnings);
    }
    
    if (input.contactQuality < 36) {
      warnings.push('Poor contact quality');
      this.consecutiveValidFrames = Math.max(0, this.consecutiveValidFrames - 1);
    }
    
    // ========== PERFUSION INDEX ==========
    const piRed = (input.redAC / input.redDC) * 100;
    const piGreen = (input.greenAC / input.greenDC) * 100;
    
    if (piRed < 0.02 || piGreen < 0.02) {
      warnings.push('Low perfusion index');
      this.consecutiveValidFrames = 0;
      return this.getWithheldResult(warnings);
    }
    
    // ========== RATIO R (R/G) ==========
    const ratioRed = input.redAC / input.redDC;
    const ratioGreen = input.greenAC / input.greenDC;
    let R = ratioRed / ratioGreen;
    
    // Compensación CHROM para movimiento
    if (piGreen > piRed * 2.0) {
      R = R * (1 - 0.05 * (piGreen / piRed - 2));
      warnings.push('CHROM compensation applied');
    }
    
    // Validar rango físico
    if (!isFinite(R) || R < 0.05 || R > 2.0) {
      warnings.push('Ratio out of physical range');
      this.consecutiveValidFrames = 0;
      return this.getWithheldResult(warnings);
    }

    // ═══ V2: VALIDACIÓN CRUZADA CON CANAL B ═══
    let blueChannelPenalty = 0;
    if (input.blueAC != null && input.blueDC != null && input.blueDC > 3 && input.blueAC > 0.005) {
      const ratioBlue = input.blueAC / input.blueDC;
      const ratioRB = ratioRed / ratioBlue;
      // Si R/B diverge mucho de R/G, probable artefacto de movimiento
      const divergence = Math.abs(R - ratioRB);
      if (divergence > 0.3) {
        blueChannelPenalty = Math.min(15, divergence * 25);
        warnings.push('R/B ratio divergence');
      }
    }
    
    // ========== SUAVIZADO DEL RATIO ==========
    this.ratioBuffer.push(R);
    if (this.ratioBuffer.length > this.RATIO_BUFFER_SIZE) {
      this.ratioBuffer.shift();
    }
    
    // Calcular R mediano; fusionar con ratios por latido si hay suficientes
    const sortedRatios = [...this.ratioBuffer].sort((a, b) => a - b);
    let medianR = sortedRatios[Math.floor(sortedRatios.length / 2)];
    if (this.beatRatioBuffer.length >= 3) {
      const br = trimmedMedian(this.beatRatioBuffer, 0.12);
      if (isFinite(br)) medianR = medianR * 0.65 + br * 0.35;
    }

    // Dedo lateral: PI verde/rojo diverge por trayectoria óptica
    const piRatio = piGreen / Math.max(piRed, 1e-6);
    if (this.ratioBuffer.length >= 8) {
      const robust = trimmedMedian(this.ratioBuffer, 0.2);
      if (isFinite(robust) && robust > 0.05) {
        let w = 0;
        if (piRatio > 2.35) w = Math.min(0.26, (piRatio - 2.35) * 0.038);
        else if (piRatio < 0.42) w = Math.min(0.22, (0.42 - piRatio) * 0.35);
        if (w > 0) medianR = medianR * (1 - w) + robust * w;
      }
    }
    
    // ═══ V2: CONVERSIÓN A SpO2 VIA CURVA CUADRÁTICA ═══
    let spO2: number;
    let calibrationState: SpO2ResultElite['calibrationState'];
    if (this.calibrator) {
      spO2 = this.calibrator.estimateSpO2(medianR);
      calibrationState = 'FACTORY_CALIBRATED';
    } else {
      // Fallback lineal si no hay calibrador inyectado
      spO2 = this.FALLBACK_INTERCEPT - this.FALLBACK_SLOPE * medianR;
      calibrationState = 'UNCALIBRATED';
    }
    
    // Ajuste por presión (compresión vascular)
    if (!input.pressureOptimal) {
      if (input.contactQuality > 70) {
        spO2 -= 1;
        warnings.push('Pressure suboptimal');
      }
    }
    
    // Clampear a rangos fisiológicos
    spO2 = Math.max(70, Math.min(100, spO2));
    
    // ========== SUAVIZADO TEMPORAL ==========
    if (this.valueHistory.length > 0) {
      const lastAvg = this.valueHistory.reduce((a, b) => a + b, 0) / this.valueHistory.length;
      const alpha = 0.3;
      spO2 = lastAvg * (1 - alpha) + spO2 * alpha;
    }
    
    this.valueHistory.push(spO2);
    if (this.valueHistory.length > this.HISTORY_SIZE) {
      this.valueHistory.shift();
    }
    
    // ========== CALCULAR CONFIANZA ==========
    this.consecutiveValidFrames++;
    
    const signalStability = this.calculateStability(this.ratioBuffer);
    let confidence = this.calculateConfidence(
      input.contactQuality,
      input.beatSQI,
      this.consecutiveValidFrames,
      signalStability,
      warnings.length
    );
    // V2: Penalización por divergencia canal B
    confidence = Math.max(0, confidence - blueChannelPenalty);
    
    const quality = Math.min(100, 
      input.contactQuality * 0.4 + 
      input.beatSQI * 0.4 + 
      Math.min(100, piRed * 500) * 0.2
    );
    
    // ═══ V2: Umbrales más exigentes para HIGH_CONF ═══
    let enabledState: SpO2ResultElite['enabledState'] = 'WITHHELD_LOW_QUALITY';
    if (confidence > 62 && this.consecutiveValidFrames > 28) {
      enabledState = 'ENABLED_HIGH_CONF';
    } else if (
      (confidence > 34 && this.consecutiveValidFrames > 12) ||
      (confidence > 26 && this.consecutiveValidFrames > 8 && quality > 26)
    ) {
      enabledState = 'ENABLED_MEDIUM_CONF';
    }
    
    const result: SpO2ResultElite = {
      value: Math.round(spO2),
      confidence: Math.round(confidence),
      quality: Math.round(quality),
      calibrationState,
      enabledState,
      opticalMetrics: {
        redAC: input.redAC,
        redDC: input.redDC,
        greenAC: input.greenAC,
        greenDC: input.greenDC,
        perfusionIndexRed: piRed,
        perfusionIndexGreen: piGreen,
        ratioR: medianR
      },
      consecutiveValidFrames: this.consecutiveValidFrames,
      validBeatRatios: this.ratioBuffer.length,
      signalStability: Math.round(signalStability * 100),
      warnings
    };
    
    this.lastValidValue = result.value;
    return result;
  }

  /** Llamar en cada pico cardíaco con ratio R/G del frame del latido */
  ingestBeatRatio(R: number): void {
    if (!isFinite(R) || R < 0.05 || R > 2.0) return;
    this.beatRatioBuffer.push(R);
    if (this.beatRatioBuffer.length > this.BEAT_RATIO_BUF) this.beatRatioBuffer.shift();
  }
  
  // ============ MÉTODOS PRIVADOS ============
  
  private calculateConfidence(
    contactQuality: number,
    beatSQI: number,
    consecutiveFrames: number,
    stability: number,
    warningCount: number
  ): number {
    let score = 0;
    score += contactQuality * 0.4;
    score += beatSQI * 0.3;
    const stabilityScore = Math.max(0, 100 - stability * 100);
    score += stabilityScore * 0.2;
    score += Math.min(100, consecutiveFrames * 2) * 0.1;
    score -= warningCount * 6;
    return Math.max(0, Math.min(100, score));
  }
  
  private calculateStability(buffer: number[]): number {
    if (buffer.length < 3) return 1.0;
    const mean = buffer.reduce((a, b) => a + b, 0) / buffer.length;
    const variance = buffer.reduce((s, v) => s + (v - mean) ** 2, 0) / buffer.length;
    const cv = Math.sqrt(variance) / mean;
    return Math.min(1, cv);
  }
  
  private getWithheldResult(warnings: string[]): SpO2ResultElite {
    return {
      value: 0,
      confidence: 0,
      quality: 0,
      calibrationState: 'UNCALIBRATED',
      enabledState: 'WITHHELD_LOW_QUALITY',
      opticalMetrics: {
        redAC: 0, redDC: 0, greenAC: 0, greenDC: 0,
        perfusionIndexRed: 0, perfusionIndexGreen: 0, ratioR: 0
      },
      consecutiveValidFrames: 0,
      validBeatRatios: 0,
      signalStability: 0,
      warnings
    };
  }
  
  // ============ API PÚBLICA ============
  
  getTrend(): 'STABLE' | 'RISING' | 'FALLING' | 'UNKNOWN' {
    if (this.valueHistory.length < 10) return 'UNKNOWN';
    const recent = this.valueHistory.slice(-10);
    const first = recent.slice(0, 5).reduce((a, b) => a + b, 0) / 5;
    const last = recent.slice(-5).reduce((a, b) => a + b, 0) / 5;
    const diff = last - first;
    if (Math.abs(diff) < 1) return 'STABLE';
    return diff > 0 ? 'RISING' : 'FALLING';
  }
  
  getStatistics(): { mean: number; min: number; max: number; cv: number } {
    if (this.valueHistory.length === 0) {
      return { mean: 0, min: 0, max: 0, cv: 0 };
    }
    const mean = this.valueHistory.reduce((a, b) => a + b, 0) / this.valueHistory.length;
    const min = Math.min(...this.valueHistory);
    const max = Math.max(...this.valueHistory);
    const variance = this.valueHistory.reduce((s, v) => s + (v - mean) ** 2, 0) / this.valueHistory.length;
    const cv = Math.sqrt(variance) / mean;
    return { mean, min, max, cv };
  }
  
  reset(): void {
    this.ratioBuffer = [];
    this.ratioQualityBuffer = [];
    this.beatRatioBuffer = [];
    this.consecutiveValidFrames = 0;
    this.valueHistory = [];
  }
}
