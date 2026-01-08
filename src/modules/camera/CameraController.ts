/**
 * CONTROLADOR SIMPLE DE CÁMARA PARA PPG
 * 
 * FILOSOFÍA: Configuración FIJA, sin ajustes automáticos
 * 
 * Para PPG funcional necesitamos:
 * 1. Exposición FIJA (no automática)
 * 2. Flash/Torch SIEMPRE encendido
 * 3. Enfoque FIJO en distancia mínima
 * 4. Sin cambios durante la medición
 * 
 * El procesamiento de señal se encarga del resto.
 */

export interface CameraCapabilities {
  hasExposure: boolean;
  exposureRange?: { min: number; max: number };
  hasISO: boolean;
  isoRange?: { min: number; max: number };
  hasColorTemp: boolean;
  colorTempRange?: { min: number; max: number };
  hasTorch: boolean;
  hasFocusDistance: boolean;
  focusDistanceRange?: { min: number; max: number };
}

export class CameraController {
  private track: MediaStreamTrack | null = null;
  private capabilities: CameraCapabilities | null = null;
  private isConfigured: boolean = false;
  
  /**
   * Configura el track de video con parámetros FIJOS óptimos para PPG
   */
  async setTrack(track: MediaStreamTrack): Promise<void> {
    this.track = track;
    this.capabilities = this.detectCapabilities(track);
    
    // Configurar UNA SOLA VEZ con parámetros fijos
    await this.applyFixedPPGSettings();
    this.isConfigured = true;
    
    console.log('✅ Cámara configurada para PPG (modo fijo)');
  }
  
  /**
   * Detecta las capacidades del hardware
   */
  private detectCapabilities(track: MediaStreamTrack): CameraCapabilities {
    const caps: any = track.getCapabilities?.() || {};
    
    return {
      hasExposure: !!caps.exposureCompensation,
      exposureRange: caps.exposureCompensation ? {
        min: caps.exposureCompensation.min,
        max: caps.exposureCompensation.max,
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
   * Aplica configuración FIJA óptima para PPG
   * Estos valores NO cambian durante la medición
   */
  private async applyFixedPPGSettings(): Promise<void> {
    if (!this.track || !this.capabilities) return;
    
    const constraints: any = { advanced: [] };
    const caps = this.capabilities;
    
    // 1. TORCH: SIEMPRE encendido
    if (caps.hasTorch) {
      constraints.advanced.push({ torch: true });
    }
    
    // 2. EXPOSICIÓN: Fija en valor medio-bajo para evitar saturación
    // Valores típicos: -3 a +3 en exposureCompensation
    if (caps.hasExposure && caps.exposureRange) {
      // Usar 40% del rango (levemente bajo para evitar saturación)
      const range = caps.exposureRange.max - caps.exposureRange.min;
      const fixedExposure = caps.exposureRange.min + (range * 0.4);
      constraints.advanced.push({ exposureCompensation: fixedExposure });
      
      console.log(`📸 Exposición fija: ${fixedExposure.toFixed(2)}`);
    }
    
    // 3. ISO: Bajo para minimizar ruido
    if (caps.hasISO && caps.isoRange) {
      // ISO bajo (25% del rango)
      const range = caps.isoRange.max - caps.isoRange.min;
      const fixedISO = caps.isoRange.min + (range * 0.25);
      constraints.advanced.push({ iso: fixedISO });
      
      console.log(`📸 ISO fijo: ${fixedISO.toFixed(0)}`);
    }
    
    // 4. BALANCE DE BLANCOS: Manual, temperatura fría
    // Temperatura fría ayuda a diferenciar canal rojo
    if (caps.hasColorTemp && caps.colorTempRange) {
      constraints.advanced.push({ 
        whiteBalanceMode: 'manual',
        colorTemperature: caps.colorTempRange.min 
      });
    }
    
    // 5. ENFOQUE: Fijo en distancia mínima (dedo sobre lente)
    if (caps.hasFocusDistance && caps.focusDistanceRange) {
      constraints.advanced.push({
        focusMode: 'manual',
        focusDistance: caps.focusDistanceRange.min
      });
    }
    
    // Aplicar todas las configuraciones
    try {
      await this.track.applyConstraints(constraints);
      console.log('✅ Configuración fija aplicada correctamente');
    } catch (error) {
      console.warn('⚠️ Error aplicando configuración completa, intentando individual...');
      
      // Fallback: aplicar una por una
      for (const setting of constraints.advanced) {
        try {
          await this.track.applyConstraints({ advanced: [setting] });
        } catch (e) {
          console.warn('⚠️ No se pudo aplicar:', setting);
        }
      }
    }
  }
  
  /**
   * Obtiene el estado actual
   */
  getState() {
    return {
      isConfigured: this.isConfigured,
      capabilities: this.capabilities,
    };
  }
  
  /**
   * Reset del controlador
   */
  reset(): void {
    // Apagar torch si está encendido
    if (this.track && this.capabilities?.hasTorch) {
      try {
        this.track.applyConstraints({ 
          advanced: [{ torch: false }] 
        }).catch(() => {});
      } catch {}
    }
    
    this.track = null;
    this.capabilities = null;
    this.isConfigured = false;
  }
}

// Singleton global
export const globalCameraController = new CameraController();
