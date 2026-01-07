/**
 * FILTRO PASABANDA IIR BUTTERWORTH 0.5-4Hz
 * 
 * Este es el filtro crítico para aislar la señal PPG cardíaca.
 * 
 * FUNDAMENTOS:
 * - Frecuencia cardíaca: 30-240 BPM = 0.5-4 Hz
 * - Elimina DC (línea base, cambios lentos de iluminación)
 * - Elimina alta frecuencia (ruido eléctrico, vibraciones)
 * 
 * IMPLEMENTACIÓN: Cascada de pasa-altos + pasa-bajos (Butterworth 2do orden)
 * 
 * Referencias:
 * - De Haan & Jeanne 2013: CHROM/POS para rPPG
 * - https://scipy-cookbook.readthedocs.io/items/ButterworthBandpass.html
 */
export class BandpassFilter {
  // Frecuencias de corte para PPG cardíaco
  private readonly LOW_CUTOFF = 0.5;  // Hz - elimina DC y respiración muy lenta
  private readonly HIGH_CUTOFF = 4.0; // Hz - elimina ruido de alta frecuencia
  
  // Coeficientes del filtro pasa-altos (elimina DC)
  private readonly HPF_A: number[] = [];
  private readonly HPF_B: number[] = [];
  
  // Coeficientes del filtro pasa-bajos (elimina HF)
  private readonly LPF_A: number[] = [];
  private readonly LPF_B: number[] = [];
  
  // Buffers de estado para filtros IIR
  private hpfX: number[] = [0, 0, 0]; // Input history
  private hpfY: number[] = [0, 0, 0]; // Output history
  private lpfX: number[] = [0, 0, 0];
  private lpfY: number[] = [0, 0, 0];
  
  private sampleRate: number;
  private initialized: boolean = false;
  
  constructor(sampleRate: number = 30) {
    this.sampleRate = sampleRate;
    this.computeCoefficients();
  }
  
  /**
   * Calcula coeficientes Butterworth 2do orden
   * Usando la transformación bilineal
   */
  private computeCoefficients(): void {
    // Pasa-altos a 0.5 Hz
    const wcHp = 2 * Math.PI * this.LOW_CUTOFF / this.sampleRate;
    const alphaHp = Math.sin(wcHp) / (2 * 0.7071); // Q = 0.7071 para Butterworth
    
    const cosWcHp = Math.cos(wcHp);
    const a0Hp = 1 + alphaHp;
    
    // Normalizar por a0
    this.HPF_B[0] = ((1 + cosWcHp) / 2) / a0Hp;
    this.HPF_B[1] = (-(1 + cosWcHp)) / a0Hp;
    this.HPF_B[2] = ((1 + cosWcHp) / 2) / a0Hp;
    this.HPF_A[0] = 1;
    this.HPF_A[1] = (-2 * cosWcHp) / a0Hp;
    this.HPF_A[2] = (1 - alphaHp) / a0Hp;
    
    // Pasa-bajos a 4 Hz
    const wcLp = 2 * Math.PI * this.HIGH_CUTOFF / this.sampleRate;
    const alphaLp = Math.sin(wcLp) / (2 * 0.7071);
    
    const cosWcLp = Math.cos(wcLp);
    const a0Lp = 1 + alphaLp;
    
    this.LPF_B[0] = ((1 - cosWcLp) / 2) / a0Lp;
    this.LPF_B[1] = (1 - cosWcLp) / a0Lp;
    this.LPF_B[2] = ((1 - cosWcLp) / 2) / a0Lp;
    this.LPF_A[0] = 1;
    this.LPF_A[1] = (-2 * cosWcLp) / a0Lp;
    this.LPF_A[2] = (1 - alphaLp) / a0Lp;
    
    this.initialized = true;
  }
  
  /**
   * Aplica filtro IIR biquad
   * y[n] = b0*x[n] + b1*x[n-1] + b2*x[n-2] - a1*y[n-1] - a2*y[n-2]
   */
  private applyBiquad(
    input: number,
    b: number[],
    a: number[],
    xHistory: number[],
    yHistory: number[]
  ): number {
    // Shift history
    xHistory[2] = xHistory[1];
    xHistory[1] = xHistory[0];
    xHistory[0] = input;
    
    yHistory[2] = yHistory[1];
    yHistory[1] = yHistory[0];
    
    // Apply filter
    yHistory[0] = b[0] * xHistory[0] + 
                  b[1] * xHistory[1] + 
                  b[2] * xHistory[2] - 
                  a[1] * yHistory[1] - 
                  a[2] * yHistory[2];
    
    // Prevenir valores extremos
    if (!isFinite(yHistory[0])) {
      yHistory[0] = 0;
    }
    
    return yHistory[0];
  }
  
  /**
   * FILTRO PASABANDA: HPF -> LPF en cascada
   * Devuelve solo el componente de frecuencia cardíaca (0.5-4Hz)
   */
  filter(value: number): number {
    if (!this.initialized || !isFinite(value)) {
      return 0;
    }
    
    // Paso 1: Pasa-altos (elimina DC y frecuencias <0.5Hz)
    const hpFiltered = this.applyBiquad(value, this.HPF_B, this.HPF_A, this.hpfX, this.hpfY);
    
    // Paso 2: Pasa-bajos (elimina frecuencias >4Hz)
    const bpFiltered = this.applyBiquad(hpFiltered, this.LPF_B, this.LPF_A, this.lpfX, this.lpfY);
    
    return bpFiltered;
  }
  
  /**
   * Resetear estados del filtro
   */
  reset(): void {
    this.hpfX = [0, 0, 0];
    this.hpfY = [0, 0, 0];
    this.lpfX = [0, 0, 0];
    this.lpfY = [0, 0, 0];
  }
  
  /**
   * Cambiar frecuencia de muestreo y recalcular coeficientes
   */
  setSampleRate(rate: number): void {
    this.sampleRate = rate;
    this.computeCoefficients();
    this.reset();
  }
}
