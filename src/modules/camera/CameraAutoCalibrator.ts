/**
 * AUTO-CALIBRADOR PPG - VERSIÓN ULTRA-LIGERA
 * 
 * PRINCIPIOS:
 * 1. SIN historial acumulativo
 * 2. Ajustes SOLO cuando es crítico (saturación extrema)
 * 3. Cooldown largo para evitar oscilaciones
 * 4. Fire-and-forget para no bloquear
 */

export interface CalibrationState {
  currentBrightness: number;
  recommendation: string;
  isSaturated: boolean;
}

export class CameraAutoCalibrator {
  // Rango objetivo MÁS ESTRICTO para evitar saturación
  private readonly TARGET_MIN = 80;
  private readonly TARGET_MAX = 200;  // Reducido de 220 para evitar saturación
  
  // Umbrales de saturación CRÍTICOS
  private readonly SATURATION_RED = 245;      // Rojo saturado
  private readonly SATURATION_COMBINED = 230; // R alto + G significativo
  
  private currentBrightness = 0;
  private track: MediaStreamTrack | null = null;
  private lastAdjustTime = 0;
  private readonly COOLDOWN = 300; // 300ms - respuesta más rápida
  
  // Estado actual de exposición
  private currentExposure = 0;
  private exposureRange = { min: 0, max: 0 };
  private hasExposure = false;
  private saturationCount = 0;

  /**
   * Configurar track de video
   */
  setTrack(track: MediaStreamTrack): void {
    this.track = track;
    const caps: any = track.getCapabilities?.() || {};
    
    if (caps.exposureCompensation) {
      this.hasExposure = true;
      this.exposureRange = {
        min: caps.exposureCompensation.min,
        max: caps.exposureCompensation.max
      };
      // Iniciar en 70% del rango para mejor iluminación inicial
      const range = this.exposureRange.max - this.exposureRange.min;
      this.currentExposure = this.exposureRange.min + range * 0.70;
      // Log removido para rendimiento
    }
  }

  /**
   * Reportar saturación desde FrameProcessor
   */
  reportSaturation(): void {
    this.saturationCount++;
    if (this.saturationCount >= 3 && this.hasExposure && this.track) {
      this.reduceExposure();
      this.saturationCount = 0;
      this.lastAdjustTime = Date.now();
    }
  }

  /**
   * Analizar brillo y ajustar - DETECCIÓN DE SATURACIÓN MEJORADA
   * Llamar cada ~10-15 frames, NO cada frame
   */
  analyze(avgRed: number, avgGreen: number, avgBlue: number): CalibrationState {
    this.currentBrightness = (avgRed + avgGreen + avgBlue) / 3;
    
    const now = Date.now();
    const canAdjust = (now - this.lastAdjustTime) > this.COOLDOWN;
    
    let recommendation = '';
    let isSaturated = false;
    
    // DETECCIÓN DE SATURACIÓN CIENTÍFICA
    // Saturación del sensor: R muy alto O (R alto + G significativo = luz blanca/flash)
    const isSensorSaturated = avgRed > this.SATURATION_RED || 
                               (avgRed > this.SATURATION_COMBINED && avgGreen > 150);
    
    if (isSensorSaturated) {
      isSaturated = true;
      recommendation = `SATURADO`;
      
      if (canAdjust && this.hasExposure && this.track) {
        this.reduceExposure();
        this.lastAdjustTime = now;
        // Log removido para rendimiento
      }
    } else if (this.currentBrightness > this.TARGET_MAX) {
      recommendation = 'Muy brillante';
      
      if (canAdjust && this.hasExposure && this.track) {
        this.reduceExposureSlightly();
        this.lastAdjustTime = now;
      }
    } else if (this.currentBrightness < 60) {
      // AUMENTADO a 60 - más proactivo para mejorar iluminación
      recommendation = 'Muy oscuro';
      
      if (canAdjust && this.hasExposure && this.track) {
        this.increaseExposure();
        this.lastAdjustTime = now;
      }
    } else if (this.currentBrightness >= this.TARGET_MIN && this.currentBrightness <= this.TARGET_MAX) {
      recommendation = 'Óptimo ✓';
    } else {
      recommendation = 'En rango';
    }
    
    return {
      currentBrightness: this.currentBrightness,
      recommendation,
      isSaturated
    };
  }

  /**
   * Reducción fuerte de exposición (saturación crítica)
   */
  private reduceExposure(): void {
    if (!this.track || !this.hasExposure) return;
    
    // Reducir 40% del rango actual
    const range = this.exposureRange.max - this.exposureRange.min;
    this.currentExposure = Math.max(
      this.exposureRange.min,
      this.currentExposure - range * 0.4
    );
    
    // Fire and forget - sin log
    this.track.applyConstraints({
      advanced: [{ exposureCompensation: this.currentExposure } as any]
    }).catch(() => {});
  }

  /**
   * Reducción ligera de exposición
   */
  private reduceExposureSlightly(): void {
    if (!this.track || !this.hasExposure) return;
    
    const range = this.exposureRange.max - this.exposureRange.min;
    this.currentExposure = Math.max(
      this.exposureRange.min,
      this.currentExposure - range * 0.15
    );
    
    this.track.applyConstraints({
      advanced: [{ exposureCompensation: this.currentExposure } as any]
    }).catch(() => {});
  }

  /**
   * Aumentar exposición (muy oscuro)
   */
  private increaseExposure(): void {
    if (!this.track || !this.hasExposure) return;
    
    const range = this.exposureRange.max - this.exposureRange.min;
    // Permitir hasta 90% del rango máximo para mejor iluminación
    const maxAllowed = this.exposureRange.min + range * 0.90;
    
    this.currentExposure = Math.min(
      maxAllowed,
      this.currentExposure + range * 0.20 // AUMENTADO de 0.15 a 0.20
    );
    
    this.track.applyConstraints({
      advanced: [{ exposureCompensation: this.currentExposure } as any]
    }).catch(() => {});
  }

  /**
   * Obtener estado actual
   */
  getState(): CalibrationState {
    return {
      currentBrightness: this.currentBrightness,
      recommendation: '',
      isSaturated: this.currentBrightness > 210
    };
  }

  /**
   * Reset
   */
  reset(): void {
    this.currentBrightness = 0;
    this.track = null;
    this.lastAdjustTime = 0;
    this.currentExposure = 0;
    this.hasExposure = false;
    this.saturationCount = 0;
  }
}

// Singleton global para acceso desde FrameProcessor
export const globalCalibrator = new CameraAutoCalibrator();
