/**
 * HEART BEAT PROCESSOR - DETECCIÓN REAL DE LATIDOS
 * Procesa señal PPG para detectar picos R y calcular BPM real
 */
export class HeartBeatProcessor {
  // Buffer de señal para detección de picos
  private signalBuffer: number[] = [];
  private readonly BUFFER_SIZE = 60; // 2 segundos a 30fps
  
  // Detección de picos
  private peakTimes: number[] = [];
  private lastPeakTime: number = 0;
  private lastPeakValue: number = 0;
  
  // Intervalos R-R para análisis de arritmias
  private rrIntervals: number[] = [];
  private readonly RR_BUFFER_SIZE = 30;
  
  // BPM suavizado
  private bpmHistory: number[] = [];
  private readonly BPM_HISTORY_SIZE = 8;
  
  // Umbrales adaptativos
  private adaptiveThreshold: number = 0;
  private signalBaseline: number = 0;
  
  // Configuración fisiológica
  private readonly CONFIG = {
    MIN_RR_MS: 300,      // 200 BPM máximo
    MAX_RR_MS: 1500,     // 40 BPM mínimo
    MIN_PEAK_PROMINENCE: 0.5,   // Prominencia mínima del pico
    REFRACTORY_MS: 250,  // Período refractario después de pico
    ADAPTIVE_ALPHA: 0.1  // Factor de adaptación del umbral
  };

  /**
   * Procesa un valor de señal y retorna el BPM actual
   */
  public processSignal(value: number, timestamp: number): number {
    // Agregar al buffer
    this.signalBuffer.push(value);
    if (this.signalBuffer.length > this.BUFFER_SIZE) {
      this.signalBuffer.shift();
    }
    
    // Necesitamos suficientes muestras
    if (this.signalBuffer.length < 15) {
      return 0;
    }
    
    // Actualizar baseline y umbral adaptativo
    this.updateAdaptiveThreshold();
    
    // Detectar pico
    const isPeak = this.detectPeak(value, timestamp);
    
    if (isPeak) {
      // Calcular intervalo R-R
      if (this.lastPeakTime > 0) {
        const rrInterval = timestamp - this.lastPeakTime;
        
        // Validar intervalo fisiológicamente
        if (rrInterval >= this.CONFIG.MIN_RR_MS && rrInterval <= this.CONFIG.MAX_RR_MS) {
          // Guardar intervalo R-R
          this.rrIntervals.push(rrInterval);
          if (this.rrIntervals.length > this.RR_BUFFER_SIZE) {
            this.rrIntervals.shift();
          }
          
          // Calcular BPM instantáneo
          const instantBpm = 60000 / rrInterval;
          
          // Filtrar outliers
          if (this.isValidBPM(instantBpm)) {
            this.bpmHistory.push(instantBpm);
            if (this.bpmHistory.length > this.BPM_HISTORY_SIZE) {
              this.bpmHistory.shift();
            }
          }
        }
      }
      
      this.lastPeakTime = timestamp;
      this.lastPeakValue = value;
      this.peakTimes.push(timestamp);
      
      // Limpiar picos antiguos
      const cutoff = timestamp - 10000; // 10 segundos
      this.peakTimes = this.peakTimes.filter(t => t > cutoff);
    }
    
    // Retornar BPM promediado
    return this.getSmoothedBPM();
  }

  /**
   * Detecta si el valor actual es un pico cardíaco
   */
  private detectPeak(value: number, timestamp: number): boolean {
    const bufferLen = this.signalBuffer.length;
    if (bufferLen < 5) return false;
    
    // Período refractario
    if (timestamp - this.lastPeakTime < this.CONFIG.REFRACTORY_MS) {
      return false;
    }
    
    // El valor debe estar por encima del umbral
    if (value < this.adaptiveThreshold) {
      return false;
    }
    
    // Verificar que es un máximo local (pico)
    const idx = bufferLen - 1;
    const prev1 = this.signalBuffer[idx - 1] || 0;
    const prev2 = this.signalBuffer[idx - 2] || 0;
    
    // El valor actual debe ser menor que el anterior (estamos en la bajada)
    // y el anterior debe ser mayor que el previo (era un pico)
    const isPeak = prev1 > prev2 && prev1 > value && 
                   prev1 > this.adaptiveThreshold;
    
    if (isPeak) {
      // Verificar prominencia del pico
      const recentMin = Math.min(...this.signalBuffer.slice(-15));
      const prominence = prev1 - recentMin;
      
      if (prominence < this.CONFIG.MIN_PEAK_PROMINENCE) {
        return false;
      }
    }
    
    return isPeak;
  }

  /**
   * Actualiza el umbral adaptativo basado en la señal reciente
   */
  private updateAdaptiveThreshold(): void {
    if (this.signalBuffer.length < 10) return;
    
    const recent = this.signalBuffer.slice(-30);
    const mean = recent.reduce((a, b) => a + b, 0) / recent.length;
    const max = Math.max(...recent);
    const min = Math.min(...recent);
    
    this.signalBaseline = mean;
    
    // Umbral = baseline + fracción de la amplitud
    const amplitude = max - min;
    const targetThreshold = mean + amplitude * 0.4;
    
    // Suavizar cambios en el umbral
    this.adaptiveThreshold = this.adaptiveThreshold * (1 - this.CONFIG.ADAPTIVE_ALPHA) + 
                             targetThreshold * this.CONFIG.ADAPTIVE_ALPHA;
  }

  /**
   * Verifica si un BPM es válido (filtro de outliers)
   */
  private isValidBPM(bpm: number): boolean {
    if (bpm < 40 || bpm > 200) return false;
    
    if (this.bpmHistory.length > 2) {
      const avgBpm = this.bpmHistory.reduce((a, b) => a + b, 0) / this.bpmHistory.length;
      // Rechazar si difiere más del 30% del promedio
      if (Math.abs(bpm - avgBpm) > avgBpm * 0.3) {
        return false;
      }
    }
    
    return true;
  }

  /**
   * Obtiene BPM suavizado
   */
  private getSmoothedBPM(): number {
    if (this.bpmHistory.length === 0) return 0;
    
    // Media recortada (excluir extremos)
    if (this.bpmHistory.length >= 4) {
      const sorted = [...this.bpmHistory].sort((a, b) => a - b);
      const trimmed = sorted.slice(1, -1);
      return Math.round(trimmed.reduce((a, b) => a + b, 0) / trimmed.length);
    }
    
    return Math.round(this.bpmHistory.reduce((a, b) => a + b, 0) / this.bpmHistory.length);
  }

  /**
   * Obtiene los intervalos R-R para análisis de arritmias
   */
  public getRRIntervals(): number[] {
    return [...this.rrIntervals];
  }

  /**
   * Obtiene el tiempo del último pico detectado
   */
  public getLastPeakTime(): number {
    return this.lastPeakTime;
  }

  /**
   * Reinicia el procesador
   */
  public reset(): void {
    this.signalBuffer = [];
    this.peakTimes = [];
    this.lastPeakTime = 0;
    this.lastPeakValue = 0;
    this.rrIntervals = [];
    this.bpmHistory = [];
    this.adaptiveThreshold = 0;
    this.signalBaseline = 0;
  }
}
