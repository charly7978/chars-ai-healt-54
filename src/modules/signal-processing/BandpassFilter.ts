/**
 * FILTRO PASABANDA IIR BUTTERWORTH 0.3-5Hz - OPTIMIZADO PARA PPG
 * 
 * CRÍTICO PARA DETECCIÓN DE LATIDOS:
 * - Frecuencia cardíaca: 18-300 BPM = 0.3-5 Hz (rango amplio para robustez)
 * - Elimina DC (línea base, cambios lentos de iluminación)
 * - Elimina alta frecuencia (ruido eléctrico, vibraciones, movimiento)
 * 
 * IMPLEMENTACIÓN: Biquad IIR con cascada de pasa-altos + pasa-bajos
 * 
 * Referencias:
 * - De Haan & Jeanne 2013: CHROM/POS para rPPG
 * - webcam-pulse-detector de thearn (GitHub 3.2k stars)
 * - https://scipy-cookbook.readthedocs.io/items/ButterworthBandpass.html
 */
export class BandpassFilter {
  // Coeficientes del filtro pasa-altos 0.5Hz (elimina DC)
  private hpfB: number[];
  private hpfA: number[];
  
  // Coeficientes del filtro pasa-bajos 4Hz (elimina ruido HF)
  private lpfB: number[];
  private lpfA: number[];
  
  // Estados internos del filtro
  private hpfState: { x: number[], y: number[] };
  private lpfState: { x: number[], y: number[] };
  
  private sampleRate: number;
  private initialized: boolean = false;
  
  constructor(sampleRate: number = 30) {
    this.sampleRate = sampleRate;
    
    // Inicializar coeficientes
    this.hpfB = [0, 0, 0];
    this.hpfA = [1, 0, 0];
    this.lpfB = [0, 0, 0];
    this.lpfA = [1, 0, 0];
    
    // Estados
    this.hpfState = { x: [0, 0, 0], y: [0, 0, 0] };
    this.lpfState = { x: [0, 0, 0], y: [0, 0, 0] };
    
    this.computeCoefficients();
  }
  
  /**
   * Calcula coeficientes Butterworth 2do orden usando transformación bilineal
   * Basado en la fórmula estándar de filtros digitales IIR
   */
  private computeCoefficients(): void {
    const fs = this.sampleRate;
    
    // === PASA-ALTOS a 0.3Hz (más permisivo para señales débiles) ===
    const fcHp = 0.3;
    const wcHp = Math.tan(Math.PI * fcHp / fs);
    const kHp = wcHp;
    const normHp = 1 / (1 + Math.sqrt(2) * kHp + kHp * kHp);
    
    this.hpfB[0] = normHp;
    this.hpfB[1] = -2 * normHp;
    this.hpfB[2] = normHp;
    this.hpfA[0] = 1;
    this.hpfA[1] = 2 * (kHp * kHp - 1) * normHp;
    this.hpfA[2] = (1 - Math.sqrt(2) * kHp + kHp * kHp) * normHp;
    
    // === PASA-BAJOS a 5Hz (captura hasta 300 BPM por seguridad) ===
    const fcLp = 5.0;
    const wcLp = Math.tan(Math.PI * fcLp / fs);
    const kLp = wcLp;
    const normLp = 1 / (1 + Math.sqrt(2) * kLp + kLp * kLp);
    
    this.lpfB[0] = kLp * kLp * normLp;
    this.lpfB[1] = 2 * kLp * kLp * normLp;
    this.lpfB[2] = kLp * kLp * normLp;
    this.lpfA[0] = 1;
    this.lpfA[1] = 2 * (kLp * kLp - 1) * normLp;
    this.lpfA[2] = (1 - Math.sqrt(2) * kLp + kLp * kLp) * normLp;
    
    this.initialized = true;
  }
  
  /**
   * Aplica filtro biquad IIR
   */
  private applyBiquad(
    input: number,
    b: number[],
    a: number[],
    state: { x: number[], y: number[] }
  ): number {
    // Desplazar historial
    state.x[2] = state.x[1];
    state.x[1] = state.x[0];
    state.x[0] = input;
    
    state.y[2] = state.y[1];
    state.y[1] = state.y[0];
    
    // Ecuación de diferencia IIR:
    // y[n] = b0*x[n] + b1*x[n-1] + b2*x[n-2] - a1*y[n-1] - a2*y[n-2]
    state.y[0] = b[0] * state.x[0] + 
                 b[1] * state.x[1] + 
                 b[2] * state.x[2] - 
                 a[1] * state.y[1] - 
                 a[2] * state.y[2];
    
    // Protección contra overflow
    if (!isFinite(state.y[0]) || Math.abs(state.y[0]) > 1e10) {
      state.y[0] = 0;
    }
    
    return state.y[0];
  }
  
  /**
   * FILTRO PASABANDA COMPLETO
   * Aplica HPF 0.5Hz -> LPF 4Hz en cascada
   * 
   * @param value Valor crudo de entrada (ej: intensidad rojo promedio)
   * @returns Valor filtrado con solo componentes de frecuencia cardíaca
   */
  filter(value: number): number {
    if (!this.initialized || !isFinite(value)) {
      return 0;
    }
    
    // Paso 1: Pasa-altos (elimina DC y deriva lenta)
    const hpFiltered = this.applyBiquad(value, this.hpfB, this.hpfA, this.hpfState);
    
    // Paso 2: Pasa-bajos (elimina ruido de alta frecuencia)
    const bpFiltered = this.applyBiquad(hpFiltered, this.lpfB, this.lpfA, this.lpfState);
    
    return bpFiltered;
  }
  
  /**
   * Resetear estados del filtro
   */
  reset(): void {
    this.hpfState = { x: [0, 0, 0], y: [0, 0, 0] };
    this.lpfState = { x: [0, 0, 0], y: [0, 0, 0] };
  }
  
  /**
   * Cambiar frecuencia de muestreo
   */
  setSampleRate(rate: number): void {
    this.sampleRate = rate;
    this.computeCoefficients();
    this.reset();
  }
}
