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
  private readonly TARGET_MIN = 80;
  private readonly TARGET_MAX = 160;
  
  private currentBrightness = 0;
  private track: MediaStreamTrack | null = null;
  private lastAdjustTime = 0;
  private readonly COOLDOWN = 2000; // 2 segundos entre ajustes
  
  // Estado actual de exposición
  private currentExposure = 0;
  private exposureRange = { min: 0, max: 0 };
  private hasExposure = false;

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
      // Iniciar en 30% del rango
      const range = this.exposureRange.max - this.exposureRange.min;
      this.currentExposure = this.exposureRange.min + range * 0.3;
    }
  }

  /**
   * Analizar brillo y ajustar SOLO si es crítico
   * Llamar cada ~10-15 frames, NO cada frame
   */
  analyze(avgRed: number, avgGreen: number, avgBlue: number): CalibrationState {
    this.currentBrightness = (avgRed + avgGreen + avgBlue) / 3;
    
    const now = Date.now();
    const canAdjust = (now - this.lastAdjustTime) > this.COOLDOWN;
    
    let recommendation = '';
    let isSaturated = false;
    
    // SOLO ajustar en casos críticos
    if (this.currentBrightness > 210) {
      isSaturated = true;
      recommendation = 'SATURADO - Reduciendo...';
      
      if (canAdjust && this.hasExposure && this.track) {
        this.reduceExposure();
        this.lastAdjustTime = now;
      }
    } else if (this.currentBrightness > 190) {
      recommendation = 'Muy brillante';
      
      if (canAdjust && this.hasExposure && this.track) {
        this.reduceExposureSlightly();
        this.lastAdjustTime = now;
      }
    } else if (this.currentBrightness < 50) {
      recommendation = 'Muy oscuro';
      
      if (canAdjust && this.hasExposure && this.track) {
        this.increaseExposure();
        this.lastAdjustTime = now;
      }
    } else if (this.currentBrightness >= this.TARGET_MIN && this.currentBrightness <= this.TARGET_MAX) {
      recommendation = 'Óptimo ✓';
    } else if (this.currentBrightness > this.TARGET_MAX) {
      recommendation = 'Ligeramente brillante';
    } else {
      recommendation = 'Ligeramente oscuro';
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
    
    // Fire and forget
    this.track.applyConstraints({
      advanced: [{ exposureCompensation: this.currentExposure } as any]
    }).catch(() => {});
    
    console.log(`📷 Exposición reducida: ${this.currentExposure.toFixed(1)}`);
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
    // No pasar del 60% del rango máximo
    const maxAllowed = this.exposureRange.min + range * 0.6;
    
    this.currentExposure = Math.min(
      maxAllowed,
      this.currentExposure + range * 0.2
    );
    
    this.track.applyConstraints({
      advanced: [{ exposureCompensation: this.currentExposure } as any]
    }).catch(() => {});
    
    console.log(`📷 Exposición aumentada: ${this.currentExposure.toFixed(1)}`);
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
  }
}

// Singleton global para acceso desde FrameProcessor
export const globalCalibrator = new CameraAutoCalibrator();
