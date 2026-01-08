/**
 * CONTROLADOR SIMPLE DE CÁMARA PARA PPG
 * 
 * FILOSOFÍA: Configuración FIJA, CONSERVADORA, sin ajustes automáticos
 * 
 * Para PPG funcional necesitamos:
 * 1. Exposición BAJA y FIJA (para evitar saturación)
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
    
    const settings: any[] = [];
    const caps = this.capabilities;
    
    // 1. TORCH: SIEMPRE encendido (lo más importante)
    if (caps.hasTorch) {
      settings.push({ torch: true });
      console.log('🔦 Flash encendido');
    }
    
    // 2. EXPOSICIÓN: BAJA para evitar saturación
    // Con el flash encendido, exposición baja es ideal
    if (caps.hasExposure && caps.exposureRange) {
      // Usar 20% del rango (MUY bajo para evitar saturación con flash)
      const range = caps.exposureRange.max - caps.exposureRange.min;
      const lowExposure = caps.exposureRange.min + (range * 0.20);
      settings.push({ exposureCompensation: lowExposure });
      
      console.log(`📸 Exposición BAJA fija: ${lowExposure.toFixed(2)} (rango: ${caps.exposureRange.min} a ${caps.exposureRange.max})`);
    }
    
    // 3. ISO: MUY bajo para minimizar ruido (con flash no necesitamos ISO alto)
    if (caps.hasISO && caps.isoRange) {
      // ISO mínimo (10% del rango)
      const range = caps.isoRange.max - caps.isoRange.min;
      const minISO = caps.isoRange.min + (range * 0.10);
      settings.push({ iso: minISO });
      
      console.log(`📸 ISO bajo fijo: ${minISO.toFixed(0)} (rango: ${caps.isoRange.min} a ${caps.isoRange.max})`);
    }
    
    // 4. BALANCE DE BLANCOS: Deshabilitado (dejamos automático para PPG)
    // En pruebas, manual puede causar problemas en algunos dispositivos
    
    // 5. ENFOQUE: Fijo en distancia mínima (dedo sobre lente)
    if (caps.hasFocusDistance && caps.focusDistanceRange) {
      settings.push({
        focusMode: 'manual',
        focusDistance: caps.focusDistanceRange.min
      });
      console.log('🎯 Enfoque en distancia mínima');
    }
    
    // Aplicar configuraciones una por una (más confiable que en lote)
    let appliedCount = 0;
    for (const setting of settings) {
      try {
        await this.track.applyConstraints({ advanced: [setting] });
        appliedCount++;
      } catch (error) {
        console.warn('⚠️ No se pudo aplicar:', Object.keys(setting)[0], error);
      }
    }
    
    console.log(`✅ Aplicadas ${appliedCount}/${settings.length} configuraciones`);
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
