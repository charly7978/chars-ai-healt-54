/**
 * CONTROLADOR DE CÁMARA - SOLO FLASH
 * 
 * SIN calibración, SIN ajustes de exposición/ISO
 * Solo enciende el flash y deja la cámara en modo automático
 */

export class CameraController {
  private track: MediaStreamTrack | null = null;
  private torchEnabled: boolean = false;
  
  /**
   * Solo enciende el flash - nada más
   */
  async setTrack(track: MediaStreamTrack): Promise<void> {
    this.track = track;
    
    // SOLO encender flash
    try {
      const caps: any = track.getCapabilities?.() || {};
      if (caps.torch) {
        await track.applyConstraints({ advanced: [{ torch: true }] });
        this.torchEnabled = true;
        console.log('🔦 Flash encendido');
      }
    } catch (e) {
      console.warn('⚠️ No se pudo encender flash');
    }
  }
  
  getState() {
    return { torchEnabled: this.torchEnabled };
  }
  
  reset(): void {
    if (this.track && this.torchEnabled) {
      try {
        this.track.applyConstraints({ advanced: [{ torch: false }] }).catch(() => {});
      } catch {}
    }
    this.track = null;
    this.torchEnabled = false;
  }
}

export const globalCameraController = new CameraController();