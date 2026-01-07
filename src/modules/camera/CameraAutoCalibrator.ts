/**
 * AUTO-CALIBRADOR DE CÁMARA PARA PPG
 * 
 * Basado en investigación de HKUST (2023):
 * "Optimizing Camera Exposure Control Settings for Remote Vital Sign Measurements"
 * https://www.ieda.ust.hk/dfaculty/so/pdf/Odinaev-et-al-CVPRW2023.pdf
 * 
 * PRINCIPIOS:
 * 1. Brillo óptimo para PPG: rango 80-160 (evitar saturación y subexposición)
 * 2. Maximizar SNR de la señal pulsátil, no el brillo general
 * 3. Ajustar exposición/ganancia dinámicamente según calidad de señal
 * 4. Priorizar exposición sobre ganancia (menos ruido)
 */

export interface CalibrationState {
  isCalibrating: boolean;
  progress: number;
  phase: 'IDLE' | 'MEASURING' | 'ADJUSTING' | 'OPTIMIZING' | 'COMPLETE';
  currentBrightness: number;
  targetBrightness: number;
  pulsatility: number;
  recommendation: string;
}

export interface CameraCapabilities {
  hasManualExposure: boolean;
  hasManualGain: boolean;
  hasTorch: boolean;
  exposureRange: { min: number; max: number } | null;
  isoRange: { min: number; max: number } | null;
  brightnessRange: { min: number; max: number } | null;
}

export class CameraAutoCalibrator {
  // Objetivo: brillo medio óptimo para PPG (según literatura)
  // Muy brillante = saturación, muy oscuro = ruido
  private readonly TARGET_BRIGHTNESS_MIN = 80;
  private readonly TARGET_BRIGHTNESS_MAX = 160;
  private readonly TARGET_BRIGHTNESS_IDEAL = 120;
  
  // Umbrales de pulsatilidad (AC/DC ratio)
  private readonly MIN_PULSATILITY = 0.005; // 0.5%
  private readonly GOOD_PULSATILITY = 0.015; // 1.5%
  
  // Estado
  private state: CalibrationState = {
    isCalibrating: false,
    progress: 0,
    phase: 'IDLE',
    currentBrightness: 0,
    targetBrightness: this.TARGET_BRIGHTNESS_IDEAL,
    pulsatility: 0,
    recommendation: ''
  };
  
  // Historial para análisis - BALANCEADO: suficiente para estabilidad, rápido para respuesta
  private brightnessHistory: number[] = [];
  private pulsatilityHistory: number[] = [];
  private readonly HISTORY_SIZE = 8; // 8 muestras = ~270ms @ 30fps
  
  // Timing para ajustes - REACTIVO pero no bloqueante
  private lastAdjustmentTime = 0;
  private readonly ADJUSTMENT_COOLDOWN = 500; // 500ms entre ajustes (balance: reactivo sin bloquear)
  
  // Capacidades detectadas
  private capabilities: CameraCapabilities | null = null;
  
  // Track de video
  private currentTrack: MediaStreamTrack | null = null;
  
  // Configuración actual
  private currentSettings = {
    exposureCompensation: 0,
    exposureTime: 0,
    iso: 0,
    brightness: 0
  };
  
  /**
   * Detectar capacidades de la cámara
   */
  async detectCapabilities(track: MediaStreamTrack): Promise<CameraCapabilities> {
    this.currentTrack = track;
    const caps: any = track.getCapabilities?.() || {};
    
    this.capabilities = {
      hasManualExposure: !!caps.exposureTime || !!caps.exposureCompensation,
      hasManualGain: !!caps.iso,
      hasTorch: caps.torch === true,
      exposureRange: caps.exposureTime ? { 
        min: caps.exposureTime.min, 
        max: caps.exposureTime.max 
      } : null,
      isoRange: caps.iso ? { 
        min: caps.iso.min, 
        max: caps.iso.max 
      } : null,
      brightnessRange: caps.brightness ? {
        min: caps.brightness.min,
        max: caps.brightness.max
      } : null
    };
    
    console.log('📷 Capacidades detectadas:', this.capabilities);
    return this.capabilities;
  }
  
  /**
   * Aplicar configuración óptima inicial para PPG
   * IMPORTANTE: NO maximizar exposición, buscar punto medio
   */
  async applyOptimalPPGSettings(track: MediaStreamTrack): Promise<void> {
    this.currentTrack = track;
    const caps: any = track.getCapabilities?.() || {};
    
    const applyConstraint = async (name: string, constraint: any): Promise<boolean> => {
      try {
        await track.applyConstraints({ advanced: [constraint] } as any);
        console.log(`✅ ${name}: ${JSON.stringify(constraint)}`);
        return true;
      } catch (err) { 
        return false; 
      }
    };
    
    // 1. TORCH - Siempre activar para PPG contacto
    if (caps.torch === true) {
      await applyConstraint('torch', { torch: true });
    }
    
    // 2. MODO MANUAL - Para control preciso
    if (caps.exposureMode?.includes?.('manual')) {
      await applyConstraint('exposureMode', { exposureMode: 'manual' });
    }
    if (caps.focusMode?.includes?.('manual')) {
      await applyConstraint('focusMode', { focusMode: 'manual' });
    }
    
    // 3. EXPOSICIÓN - Punto MEDIO, no máximo
    // Según HKUST 2023: exposición alta = saturación = pérdida de señal PPG
    if (caps.exposureCompensation) {
      // Usar 30% del rango máximo, no el máximo
      const range = caps.exposureCompensation.max - caps.exposureCompensation.min;
      const optimal = caps.exposureCompensation.min + range * 0.3;
      this.currentSettings.exposureCompensation = optimal;
      await applyConstraint('exposureCompensation', { exposureCompensation: optimal });
    }
    
    if (caps.exposureTime) {
      // Tiempo medio-bajo para evitar motion blur y saturación
      // 1/60s = 16666µs es buen balance
      const targetTime = Math.min(16666, caps.exposureTime.max);
      const optimalTime = Math.max(caps.exposureTime.min, targetTime);
      this.currentSettings.exposureTime = optimalTime;
      await applyConstraint('exposureTime', { exposureTime: optimalTime });
    }
    
    // 4. ISO - Bajo para menos ruido
    // Priorizar exposición sobre ganancia (menos ruido según literatura)
    if (caps.iso) {
      const lowIso = Math.min(caps.iso.min + 200, caps.iso.max);
      this.currentSettings.iso = lowIso;
      await applyConstraint('iso', { iso: lowIso });
    }
    
    // 5. BRILLO - Medio
    if (caps.brightness) {
      const range = caps.brightness.max - caps.brightness.min;
      const midBrightness = caps.brightness.min + range * 0.4;
      this.currentSettings.brightness = midBrightness;
      await applyConstraint('brightness', { brightness: midBrightness });
    }
    
    // 6. BALANCE DE BLANCOS - Incandescente para piel+flash
    if (caps.whiteBalanceMode?.includes?.('incandescent')) {
      await applyConstraint('whiteBalanceMode', { whiteBalanceMode: 'incandescent' });
    }
    
    // 7. FOCUS - Cercano para dedo
    if (caps.focusDistance?.min !== undefined) {
      await applyConstraint('focusDistance', { focusDistance: caps.focusDistance.min });
    }
    
    console.log('📷 Configuración PPG inicial aplicada');
  }
  
  /**
   * Analizar frame y ajustar exposición automáticamente
   * Llamar cada frame durante medición
   */
  analyzeAndAdjust(
    avgRed: number, 
    avgGreen: number, 
    avgBlue: number,
    acComponent: number
  ): CalibrationState {
    // Calcular brillo actual
    const brightness = (avgRed + avgGreen + avgBlue) / 3;
    
    // Calcular pulsatilidad
    const dc = brightness;
    const pulsatility = dc > 0 ? acComponent / dc : 0;
    
    // Actualizar historial
    this.brightnessHistory.push(brightness);
    this.pulsatilityHistory.push(pulsatility);
    
    if (this.brightnessHistory.length > this.HISTORY_SIZE) {
      this.brightnessHistory.shift();
      this.pulsatilityHistory.shift();
    }
    
    // Calcular promedios
    const avgBrightness = this.brightnessHistory.reduce((a, b) => a + b, 0) / this.brightnessHistory.length;
    const avgPulsatility = this.pulsatilityHistory.reduce((a, b) => a + b, 0) / this.pulsatilityHistory.length;
    
    // Actualizar estado
    this.state.currentBrightness = avgBrightness;
    this.state.pulsatility = avgPulsatility;
    
    // Generar recomendación
    this.state.recommendation = this.generateRecommendation(avgBrightness, avgPulsatility);
    
    // Auto-ajustar si hay problema Y suficiente tiempo ha pasado
    const now = Date.now();
    const timeSinceLastAdjust = now - this.lastAdjustmentTime;
    
    // Ajustar si: cooldown pasó Y hay desviación significativa
    if (this.currentTrack && timeSinceLastAdjust >= this.ADJUSTMENT_COOLDOWN) {
      // Ajustar si está fuera del rango óptimo (80-160)
      const needsAdjust = avgBrightness > this.TARGET_BRIGHTNESS_MAX || 
                          avgBrightness < this.TARGET_BRIGHTNESS_MIN ||
                          brightness > 210 || brightness < 50;
      
      if (needsAdjust) {
        this.autoAdjustExposure(avgBrightness, avgPulsatility, brightness);
        this.lastAdjustmentTime = now;
      }
    }
    
    return { ...this.state };
  }
  
  /**
   * Generar recomendación basada en estado actual
   */
  private generateRecommendation(brightness: number, pulsatility: number): string {
    if (brightness > 200) {
      return 'SATURADO - Reducir exposición';
    }
    if (brightness < 50) {
      return 'MUY OSCURO - Verificar dedo y flash';
    }
    if (brightness > this.TARGET_BRIGHTNESS_MAX) {
      return 'SOBREEXPUESTO - Ajustando...';
    }
    if (brightness < this.TARGET_BRIGHTNESS_MIN) {
      return 'SUBEXPUESTO - Ajustando...';
    }
    if (pulsatility < this.MIN_PULSATILITY) {
      return 'SIN PULSO - Ajustar posición del dedo';
    }
    if (pulsatility >= this.GOOD_PULSATILITY) {
      return 'SEÑAL ÓPTIMA ✓';
    }
    return 'SEÑAL ACEPTABLE';
  }
  
  /**
   * Ajustar exposición automáticamente - VERSIÓN NO BLOQUEANTE
   * Según WebRTC best practices: fire-and-forget para evitar bloqueos
   */
  private autoAdjustExposure(
    avgBrightness: number, 
    pulsatility: number,
    instantBrightness?: number
  ): void {
    if (!this.currentTrack || !this.capabilities) return;
    
    const caps: any = this.currentTrack.getCapabilities?.() || {};
    const brightness = instantBrightness ?? avgBrightness;
    
    // Calcular qué tan lejos estamos del objetivo
    const deviation = brightness - this.TARGET_BRIGHTNESS_IDEAL;
    const deviationPercent = Math.abs(deviation) / this.TARGET_BRIGHTNESS_IDEAL;
    
    // AJUSTE PROPORCIONAL: más lejos del objetivo = ajuste más agresivo
    const adjustmentStrength = Math.min(2.0, 0.5 + deviationPercent * 3);
    
    let adjusted = false;
    
    // SATURACIÓN CRÍTICA (>220) - ACCIÓN INMEDIATA
    if (brightness > 220) {
      console.log('📷 ⚠️ SATURACIÓN CRÍTICA - Reducción máxima');
      this.applyEmergencyReduction(caps);
      this.state.phase = 'ADJUSTING';
      return;
    }
    
    // SOBREEXPUESTO (>160) - Reducir exposición
    if (brightness > this.TARGET_BRIGHTNESS_MAX) {
      adjusted = true;
      const reductionFactor = adjustmentStrength;
      
      // Reducir exposureCompensation
      if (caps.exposureCompensation) {
        const range = caps.exposureCompensation.max - caps.exposureCompensation.min;
        const step = range * 0.1 * reductionFactor;
        this.currentSettings.exposureCompensation = Math.max(
          caps.exposureCompensation.min,
          this.currentSettings.exposureCompensation - step
        );
        this.applyConstraintFast('exposureCompensation', this.currentSettings.exposureCompensation);
      }
      
      // Reducir ISO si está muy sobreexpuesto
      if (caps.iso && brightness > 180) {
        const isoStep = Math.floor(50 * reductionFactor);
        this.currentSettings.iso = Math.max(caps.iso.min, this.currentSettings.iso - isoStep);
        this.applyConstraintFast('iso', this.currentSettings.iso);
      }
      
      // Reducir brightness si disponible
      if (caps.brightness && brightness > 190) {
        const bRange = caps.brightness.max - caps.brightness.min;
        const bStep = bRange * 0.15 * reductionFactor;
        this.currentSettings.brightness = Math.max(
          caps.brightness.min,
          this.currentSettings.brightness - bStep
        );
        this.applyConstraintFast('brightness', this.currentSettings.brightness);
      }
    }
    
    // SUBEXPUESTO (<80) - Aumentar exposición
    if (brightness < this.TARGET_BRIGHTNESS_MIN) {
      adjusted = true;
      const increaseFactor = adjustmentStrength * 0.8;
      
      if (caps.exposureCompensation) {
        const range = caps.exposureCompensation.max - caps.exposureCompensation.min;
        const maxAllowed = caps.exposureCompensation.min + range * 0.7;
        const step = range * 0.08 * increaseFactor;
        this.currentSettings.exposureCompensation = Math.min(
          maxAllowed,
          this.currentSettings.exposureCompensation + step
        );
        this.applyConstraintFast('exposureCompensation', this.currentSettings.exposureCompensation);
      }
      
      if (caps.brightness && brightness < 60) {
        const bRange = caps.brightness.max - caps.brightness.min;
        const bStep = bRange * 0.1 * increaseFactor;
        this.currentSettings.brightness = Math.min(
          caps.brightness.min + bRange * 0.6,
          this.currentSettings.brightness + bStep
        );
        this.applyConstraintFast('brightness', this.currentSettings.brightness);
      }
    }
    
    // Actualizar fase
    if (adjusted) {
      this.state.phase = 'ADJUSTING';
      this.state.progress = Math.min(95, this.state.progress + 5);
    } else if (brightness >= this.TARGET_BRIGHTNESS_MIN && brightness <= this.TARGET_BRIGHTNESS_MAX) {
      this.state.phase = 'COMPLETE';
      this.state.progress = 100;
    }
  }
  
  /**
   * Aplicar constraint de forma NO BLOQUEANTE (fire and forget)
   * Según WebRTC best practices: no esperar respuesta para evitar bloqueos
   */
  private applyConstraintFast(name: string, value: number): void {
    if (!this.currentTrack) return;
    // Fire and forget - no await, no bloqueo
    this.currentTrack.applyConstraints({ 
      advanced: [{ [name]: value }] 
    } as any).catch(() => {});
  }
  
  /**
   * Reducción de emergencia para saturación crítica - NO BLOQUEANTE
   */
  private applyEmergencyReduction(caps: any): void {
    if (caps.exposureCompensation) {
      this.currentSettings.exposureCompensation = caps.exposureCompensation.min;
      this.applyConstraintFast('exposureCompensation', caps.exposureCompensation.min);
    }
    
    if (caps.iso) {
      this.currentSettings.iso = caps.iso.min;
      this.applyConstraintFast('iso', caps.iso.min);
    }
    
    if (caps.brightness) {
      const lowBrightness = caps.brightness.min + (caps.brightness.max - caps.brightness.min) * 0.15;
      this.currentSettings.brightness = lowBrightness;
      this.applyConstraintFast('brightness', lowBrightness);
    }
  }
  
  /**
   * Forzar reducción de exposición (para cuando está saturado)
   */
  async forceReduceExposure(): Promise<void> {
    if (!this.currentTrack) return;
    
    const caps: any = this.currentTrack.getCapabilities?.() || {};
    
    // Reducir todo a mínimo
    if (caps.exposureCompensation) {
      await this.currentTrack.applyConstraints({ 
        advanced: [{ exposureCompensation: caps.exposureCompensation.min }] 
      } as any).catch(() => {});
    }
    
    if (caps.iso) {
      await this.currentTrack.applyConstraints({ 
        advanced: [{ iso: caps.iso.min }] 
      } as any).catch(() => {});
    }
    
    if (caps.brightness) {
      const lowBrightness = caps.brightness.min + (caps.brightness.max - caps.brightness.min) * 0.2;
      await this.currentTrack.applyConstraints({ 
        advanced: [{ brightness: lowBrightness }] 
      } as any).catch(() => {});
    }
    
    console.log('📷 Exposición reducida a mínimo');
  }
  
  /**
   * Obtener estado actual
   */
  getState(): CalibrationState {
    return { ...this.state };
  }
  
  /**
   * Reset
   */
  reset(): void {
    this.brightnessHistory = [];
    this.pulsatilityHistory = [];
    this.lastAdjustmentTime = 0;
    this.state = {
      isCalibrating: false,
      progress: 0,
      phase: 'IDLE',
      currentBrightness: 0,
      targetBrightness: this.TARGET_BRIGHTNESS_IDEAL,
      pulsatility: 0,
      recommendation: ''
    };
    this.currentSettings = {
      exposureCompensation: 0,
      exposureTime: 0,
      iso: 0,
      brightness: 0
    };
  }
}
