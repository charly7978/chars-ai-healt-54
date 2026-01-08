/**
 * CONTROLADOR INTELIGENTE DE CÁMARA PARA PPG
 * 
 * Sistema guiado por la calidad de la señal PPG, no por brillo genérico.
 * Usa controladores PID para ajustes suaves y rápidos.
 * 
 * El algoritmo de señal COMANDA los parámetros de cámara:
 * - SNR bajo → aumentar exposición/luz
 * - Saturación → reducir exposición inmediatamente
 * - Pulsatilidad baja → ajustar ganancia (ISO)
 * 
 * Referencias:
 * - Yi S. et al. "Skin-Guided Auto-Exposure" IEEE EMBC 2024
 */

import { PIDController } from './PIDController';

// ============= TIPOS =============

export type CalibrationAction = 
  | 'INCREASE_LIGHT'    // SNR bajo, necesita más iluminación
  | 'REDUCE_EXPOSURE'   // Saturación, reducir exposición urgente
  | 'ADJUST_GAIN'       // Pulsatilidad baja, ajustar ISO
  | 'OPTIMIZE_COLOR'    // Mejorar balance de blancos para rojo
  | 'MAINTAIN';         // Todo está bien, mantener

export type CalibrationUrgency = 'urgent' | 'normal' | 'none';

export interface CalibrationCommand {
  action: CalibrationAction;
  urgency: CalibrationUrgency;
  /** Valor sugerido para el ajuste (0-1 normalizado) */
  targetValue?: number;
}

export interface SignalMetrics {
  snr: number;
  dcLevel: number;
  acAmplitude: number;
  isSaturated: boolean;
  perfusionIndex: number;
  periodicity: number;
  fingerConfidence: number;
}

export interface CameraCapabilities {
  hasExposure: boolean;
  exposureRange?: { min: number; max: number };
  hasExposureTime: boolean;
  exposureTimeRange?: { min: number; max: number };
  hasISO: boolean;
  isoRange?: { min: number; max: number };
  hasColorTemp: boolean;
  colorTempRange?: { min: number; max: number };
  hasTorch: boolean;
  hasFocusDistance: boolean;
  focusDistanceRange?: { min: number; max: number };
}

export interface PPGOptimizationTarget {
  /** SNR objetivo en dB */
  targetSNR: number;
  /** Nivel DC objetivo (0-255) */
  targetDC: number;
  /** Perfusion Index mínimo (%) */
  minPerfusion: number;
  /** Límite de saturación */
  maxSaturation: number;
}

// ============= CONTROLADOR PRINCIPAL =============

export class CameraController {
  // Objetivos de optimización
  private readonly targets: PPGOptimizationTarget = {
    targetSNR: 8,        // 8 dB es bueno para PPG
    targetDC: 140,       // Nivel DC óptimo
    minPerfusion: 0.3,   // 0.3% mínimo
    maxSaturation: 245,  // Evitar saturación
  };
  
  // Controladores PID para cada parámetro
  private exposurePID: PIDController;
  private isoPID: PIDController;
  
  // Estado actual
  private track: MediaStreamTrack | null = null;
  private capabilities: CameraCapabilities | null = null;
  private currentExposure: number = 0.6;  // Normalizado 0-1
  private currentISO: number = 0.3;       // Normalizado 0-1
  private currentColorTemp: number = 0;   // Normalizado 0-1 (0 = frío)
  private isTorchOn: boolean = false;
  
  // Control de tiempo
  private lastAdjustTime: number = 0;
  private readonly MIN_INTERVAL = 50;  // 50ms mínimo entre ajustes
  private framesSinceAdjust: number = 0;
  
  // Estado de saturación
  private consecutiveSaturationFrames: number = 0;
  private readonly SATURATION_THRESHOLD = 3;  // 3 frames seguidos = saturación confirmada
  
  constructor() {
    // PID para exposición: respuesta moderada, estabilidad alta
    this.exposurePID = new PIDController({
      kp: 0.4,
      ki: 0.08,
      kd: 0.02,
      outputMin: 0.1,
      outputMax: 0.95,
      integralLimit: 0.3,
    });
    
    // PID para ISO: respuesta más lenta (ISO cambia ruido)
    this.isoPID = new PIDController({
      kp: 0.25,
      ki: 0.05,
      kd: 0.01,
      outputMin: 0.1,
      outputMax: 0.6,  // Limitar ISO para evitar ruido excesivo
      integralLimit: 0.2,
    });
  }
  
  // ============= CONFIGURACIÓN =============
  
  /**
   * Configura el track de video y detecta capacidades
   */
  async setTrack(track: MediaStreamTrack): Promise<void> {
    this.track = track;
    this.capabilities = this.detectCapabilities(track);
    
    // Aplicar configuración inicial óptima para PPG
    await this.applyInitialPPGSettings();
  }
  
  /**
   * Detecta las capacidades del hardware de la cámara
   */
  private detectCapabilities(track: MediaStreamTrack): CameraCapabilities {
    const caps: any = track.getCapabilities?.() || {};
    
    return {
      hasExposure: !!caps.exposureCompensation,
      exposureRange: caps.exposureCompensation ? {
        min: caps.exposureCompensation.min,
        max: caps.exposureCompensation.max,
      } : undefined,
      hasExposureTime: !!caps.exposureTime,
      exposureTimeRange: caps.exposureTime ? {
        min: caps.exposureTime.min,
        max: caps.exposureTime.max,
      } : undefined,
      hasISO: !!caps.iso,
      isoRange: caps.iso ? {
        min: caps.iso.min,
        max: caps.iso.max,
      } : undefined,
      hasColorTemp: !!caps.colorTemperature,
      colorTempRange: caps.colorTemperature ? {
        min: caps.colorTemperature.min,
        max: caps.colorTemperature.max,
      } : undefined,
      hasTorch: caps.torch === true,
      hasFocusDistance: !!caps.focusDistance,
      focusDistanceRange: caps.focusDistance ? {
        min: caps.focusDistance.min,
        max: caps.focusDistance.max,
      } : undefined,
    };
  }
  
  /**
   * Aplica configuración inicial óptima para captura PPG
   */
  private async applyInitialPPGSettings(): Promise<void> {
    if (!this.track || !this.capabilities) return;
    
    const settings: any[] = [];
    const caps = this.capabilities;
    
    // 1. TORCH: Siempre encendido para PPG
    if (caps.hasTorch) {
      settings.push({ torch: true });
      this.isTorchOn = true;
    }
    
    // 2. EXPOSICIÓN: Iniciar en 60% para evitar saturación
    if (caps.hasExposure && caps.exposureRange) {
      const range = caps.exposureRange.max - caps.exposureRange.min;
      const initialExposure = caps.exposureRange.min + range * 0.6;
      settings.push({ exposureCompensation: initialExposure });
      this.currentExposure = 0.6;
    }
    
    // 3. ISO: Bajo para minimizar ruido
    if (caps.hasISO && caps.isoRange) {
      const range = caps.isoRange.max - caps.isoRange.min;
      const initialISO = caps.isoRange.min + range * 0.25;
      settings.push({ iso: initialISO });
      this.currentISO = 0.25;
    }
    
    // 4. COLOR TEMPERATURE: Frío para maximizar diferencia R/G
    if (caps.hasColorTemp && caps.colorTempRange) {
      settings.push({ colorTemperature: caps.colorTempRange.min });
      settings.push({ whiteBalanceMode: 'manual' });
      this.currentColorTemp = 0;
    }
    
    // 5. FOCUS: Lo más cercano posible (dedo sobre el lente)
    if (caps.hasFocusDistance && caps.focusDistanceRange) {
      settings.push({ focusDistance: caps.focusDistanceRange.min });
      settings.push({ focusMode: 'manual' });
    }
    
    // Aplicar todos los settings
    if (settings.length > 0) {
      try {
        await this.track.applyConstraints({ advanced: settings } as any);
      } catch (e) {
        // Intentar aplicar uno por uno si falla en lote
        for (const setting of settings) {
          try {
            await this.track.applyConstraints({ advanced: [setting] } as any);
          } catch {}
        }
      }
    }
  }
  
  // ============= OPTIMIZACIÓN EN TIEMPO REAL =============
  
  /**
   * MÉTODO PRINCIPAL: Recibe comando del SignalQualityAnalyzer y ajusta cámara
   * Llamar cada frame (o cada 2-3 frames) con las métricas actuales
   */
  async executeCommand(command: CalibrationCommand, metrics: SignalMetrics): Promise<void> {
    if (!this.track || !this.capabilities) return;
    
    const now = performance.now();
    this.framesSinceAdjust++;
    
    // Trackear saturación
    if (metrics.isSaturated) {
      this.consecutiveSaturationFrames++;
    } else {
      this.consecutiveSaturationFrames = 0;
    }
    
    // Si no hay urgencia y poco tiempo pasó, skip
    if (command.urgency === 'none' && (now - this.lastAdjustTime) < 100) {
      return;
    }
    
    // Saturación confirmada = acción inmediata
    if (this.consecutiveSaturationFrames >= this.SATURATION_THRESHOLD) {
      await this.reduceExposureUrgent();
      this.lastAdjustTime = now;
      this.consecutiveSaturationFrames = 0;
      return;
    }
    
    // Rate limiting normal
    if ((now - this.lastAdjustTime) < this.MIN_INTERVAL) return;
    
    // Ejecutar acción según comando
    switch (command.action) {
      case 'INCREASE_LIGHT':
        await this.increaseLight(metrics);
        break;
      case 'REDUCE_EXPOSURE':
        await this.reduceExposure(metrics);
        break;
      case 'ADJUST_GAIN':
        await this.adjustGain(metrics);
        break;
      case 'OPTIMIZE_COLOR':
        await this.optimizeColorTemp();
        break;
      case 'MAINTAIN':
        // Pequeños ajustes de mantenimiento via PID
        if (this.framesSinceAdjust > 30) {
          await this.maintainOptimal(metrics);
        }
        break;
    }
    
    this.lastAdjustTime = now;
    this.framesSinceAdjust = 0;
  }
  
  /**
   * Aumentar luz cuando SNR es bajo
   */
  private async increaseLight(metrics: SignalMetrics): Promise<void> {
    if (!this.track || !this.capabilities) return;
    
    // Usar PID para calcular ajuste suave
    const targetDC = this.targets.targetDC;
    const pidOutput = this.exposurePID.compute(targetDC, metrics.dcLevel);
    
    // Aplicar si hay cambio significativo
    if (Math.abs(pidOutput - this.currentExposure) > 0.02) {
      this.currentExposure = pidOutput;
      await this.applyExposure(pidOutput);
    }
    
    // Si exposición ya está alta y aún falta luz, subir ISO
    if (this.currentExposure > 0.8 && metrics.snr < this.targets.targetSNR) {
      const isoOutput = this.isoPID.compute(this.targets.targetSNR, metrics.snr);
      if (isoOutput > this.currentISO + 0.05) {
        this.currentISO = Math.min(0.5, isoOutput);  // Limitar ISO
        await this.applyISO(this.currentISO);
      }
    }
  }
  
  /**
   * Reducir exposición cuando hay saturación
   */
  private async reduceExposure(metrics: SignalMetrics): Promise<void> {
    if (!this.track || !this.capabilities) return;
    
    // PID inverso: queremos bajar DC
    const pidOutput = this.exposurePID.compute(this.targets.targetDC, metrics.dcLevel);
    
    if (pidOutput < this.currentExposure - 0.02) {
      this.currentExposure = pidOutput;
      await this.applyExposure(pidOutput);
    }
  }
  
  /**
   * Reducción urgente de exposición (saturación confirmada)
   */
  private async reduceExposureUrgent(): Promise<void> {
    if (!this.track || !this.capabilities) return;
    
    // Reducir 25% inmediatamente
    this.currentExposure = Math.max(0.15, this.currentExposure * 0.75);
    
    // También reducir ISO si está alto
    if (this.currentISO > 0.3) {
      this.currentISO = Math.max(0.15, this.currentISO * 0.7);
      await this.applyISO(this.currentISO);
    }
    
    await this.applyExposure(this.currentExposure);
    
    // Reset PIDs para evitar que intenten compensar
    this.exposurePID.reset();
    this.isoPID.reset();
  }
  
  /**
   * Ajustar ganancia (ISO) para mejorar pulsatilidad
   */
  private async adjustGain(metrics: SignalMetrics): Promise<void> {
    if (!this.track || !this.capabilities?.hasISO) return;
    
    // Si perfusion es baja, subir ISO gradualmente
    if (metrics.perfusionIndex < this.targets.minPerfusion) {
      const targetISO = Math.min(0.5, this.currentISO + 0.05);
      const pidOutput = this.isoPID.compute(targetISO, this.currentISO);
      
      if (pidOutput > this.currentISO + 0.02) {
        this.currentISO = pidOutput;
        await this.applyISO(pidOutput);
      }
    }
  }
  
  /**
   * Optimizar temperatura de color para maximizar señal roja
   */
  private async optimizeColorTemp(): Promise<void> {
    if (!this.track || !this.capabilities?.hasColorTemp) return;
    
    // Temperatura fría maximiza diferencia R/G
    if (this.currentColorTemp > 0.1) {
      this.currentColorTemp = 0;
      const caps = this.capabilities.colorTempRange!;
      await this.track.applyConstraints({
        advanced: [{ colorTemperature: caps.min } as any]
      }).catch(() => {});
    }
  }
  
  /**
   * Mantenimiento: pequeños ajustes cuando todo está bien
   */
  private async maintainOptimal(metrics: SignalMetrics): Promise<void> {
    if (!this.track || !this.capabilities) return;
    
    // Solo ajustar si hay desviación significativa
    const dcError = Math.abs(metrics.dcLevel - this.targets.targetDC);
    
    if (dcError > 20) {
      const pidOutput = this.exposurePID.compute(this.targets.targetDC, metrics.dcLevel);
      if (Math.abs(pidOutput - this.currentExposure) > 0.03) {
        this.currentExposure = pidOutput;
        await this.applyExposure(pidOutput);
      }
    }
  }
  
  // ============= APLICACIÓN DE PARÁMETROS =============
  
  /**
   * Aplica valor de exposición (normalizado 0-1)
   */
  private async applyExposure(normalized: number): Promise<void> {
    if (!this.track || !this.capabilities?.hasExposure) return;
    
    const range = this.capabilities.exposureRange!;
    const value = range.min + (range.max - range.min) * normalized;
    
    await this.track.applyConstraints({
      advanced: [{ exposureCompensation: value } as any]
    }).catch(() => {});
  }
  
  /**
   * Aplica valor de ISO (normalizado 0-1)
   */
  private async applyISO(normalized: number): Promise<void> {
    if (!this.track || !this.capabilities?.hasISO) return;
    
    const range = this.capabilities.isoRange!;
    const value = range.min + (range.max - range.min) * normalized;
    
    await this.track.applyConstraints({
      advanced: [{ iso: value } as any]
    }).catch(() => {});
  }
  
  // ============= UTILIDADES =============
  
  /**
   * Genera comando de calibración basado en métricas
   * USADO POR SignalQualityAnalyzer
   */
  static generateCommand(metrics: SignalMetrics): CalibrationCommand {
    // Saturación = máxima urgencia
    if (metrics.isSaturated || metrics.dcLevel > 245) {
      return { action: 'REDUCE_EXPOSURE', urgency: 'urgent' };
    }
    
    // SNR muy bajo = necesita luz
    if (metrics.snr < 4) {
      return { action: 'INCREASE_LIGHT', urgency: 'normal' };
    }
    
    // Perfusion muy baja = ajustar ganancia
    if (metrics.perfusionIndex < 0.1 && metrics.fingerConfidence > 0.3) {
      return { action: 'ADJUST_GAIN', urgency: 'normal' };
    }
    
    // DC muy bajo = necesita más luz
    if (metrics.dcLevel < 80) {
      return { action: 'INCREASE_LIGHT', urgency: 'normal' };
    }
    
    // DC muy alto (pero sin saturar) = reducir
    if (metrics.dcLevel > 200) {
      return { action: 'REDUCE_EXPOSURE', urgency: 'normal' };
    }
    
    // Todo bien
    return { action: 'MAINTAIN', urgency: 'none' };
  }
  
  /**
   * Obtiene estado actual del controlador
   */
  getState(): {
    exposure: number;
    iso: number;
    colorTemp: number;
    torchOn: boolean;
    capabilities: CameraCapabilities | null;
  } {
    return {
      exposure: this.currentExposure,
      iso: this.currentISO,
      colorTemp: this.currentColorTemp,
      torchOn: this.isTorchOn,
      capabilities: this.capabilities,
    };
  }
  
  /**
   * Reset completo del controlador
   */
  reset(): void {
    this.track = null;
    this.capabilities = null;
    this.currentExposure = 0.6;
    this.currentISO = 0.3;
    this.currentColorTemp = 0;
    this.isTorchOn = false;
    this.lastAdjustTime = 0;
    this.framesSinceAdjust = 0;
    this.consecutiveSaturationFrames = 0;
    this.exposurePID.reset();
    this.isoPID.reset();
  }
}

// Singleton global para acceso desde múltiples módulos
export const globalCameraController = new CameraController();
