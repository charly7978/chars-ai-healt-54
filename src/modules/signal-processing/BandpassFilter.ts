/**
 * =========================================================================
 * FILTRO PASABANDA IIR BUTTERWORTH + SAVITZKY-GOLAY
 * =========================================================================
 * 
 * PIPELINE DE PREPROCESADO:
 * 1. Filtro pasa-altos 0.5Hz (elimina DC y deriva lenta)
 * 2. Filtro pasa-bajos 4Hz (elimina ruido HF y artefactos de movimiento)
 * 3. Suavizado Savitzky-Golay (preserva picos sin distorsión)
 * 4. Detección de outliers
 * 
 * BANDA DE PASO: 0.5-4Hz = 30-240 BPM
 * 
 * Referencias:
 * - De Haan & Jeanne 2013: CHROM/POS para rPPG
 * - Elgendi 2012: Optimal PPG filter design
 * - Savitzky-Golay 1964: Smoothing and differentiation
 * =========================================================================
 */
export class BandpassFilter {
  // Coeficientes del filtro pasa-altos 0.5Hz
  private hpfB: number[];
  private hpfA: number[];
  
  // Coeficientes del filtro pasa-bajos 4Hz
  private lpfB: number[];
  private lpfA: number[];
  
  // Estados internos del filtro
  private hpfState: { x: number[], y: number[] };
  private lpfState: { x: number[], y: number[] };
  
  // Buffer para Savitzky-Golay
  private sgBuffer: number[] = [];
  private readonly SG_WINDOW = 5; // Ventana de 5 puntos
  
  // Buffer para detección de outliers
  private recentValues: number[] = [];
  private readonly OUTLIER_WINDOW = 30;
  
  private sampleRate: number;
  private initialized: boolean = false;
  
  // Coeficientes Savitzky-Golay para ventana de 5 puntos, polinomio grado 2
  // Estos coeficientes suavizan sin distorsionar los picos
  private readonly SG_COEFFICIENTS = [-3, 12, 17, 12, -3]; // /35
  private readonly SG_NORMALIZER = 35;
  
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
   */
  private computeCoefficients(): void {
    const fs = this.sampleRate;
    
    // === PASA-ALTOS a 0.5Hz ===
    const fcHp = 0.5;
    const wcHp = Math.tan(Math.PI * fcHp / fs);
    const kHp = wcHp;
    const normHp = 1 / (1 + Math.sqrt(2) * kHp + kHp * kHp);
    
    this.hpfB[0] = normHp;
    this.hpfB[1] = -2 * normHp;
    this.hpfB[2] = normHp;
    this.hpfA[0] = 1;
    this.hpfA[1] = 2 * (kHp * kHp - 1) * normHp;
    this.hpfA[2] = (1 - Math.sqrt(2) * kHp + kHp * kHp) * normHp;
    
    // === PASA-BAJOS a 4Hz ===
    const fcLp = 4.0;
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
    
    // Ecuación de diferencia IIR
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
   * SUAVIZADO SAVITZKY-GOLAY
   * Preserva forma de picos mientras reduce ruido
   */
  private applySavitzkyGolay(value: number): number {
    this.sgBuffer.push(value);
    
    if (this.sgBuffer.length > this.SG_WINDOW) {
      this.sgBuffer.shift();
    }
    
    if (this.sgBuffer.length < this.SG_WINDOW) {
      return value;
    }
    
    // Aplicar coeficientes S-G
    let smoothed = 0;
    for (let i = 0; i < this.SG_WINDOW; i++) {
      smoothed += this.SG_COEFFICIENTS[i] * this.sgBuffer[i];
    }
    
    return smoothed / this.SG_NORMALIZER;
  }
  
  /**
   * DETECCIÓN DE OUTLIERS
   * Si valor está a más de 3 sigma del promedio, es artefacto
   */
  private handleOutlier(value: number): { value: number; isOutlier: boolean } {
    this.recentValues.push(value);
    
    if (this.recentValues.length > this.OUTLIER_WINDOW) {
      this.recentValues.shift();
    }
    
    if (this.recentValues.length < 10) {
      return { value, isOutlier: false };
    }
    
    // Calcular media y desviación estándar
    const mean = this.recentValues.reduce((a, b) => a + b, 0) / this.recentValues.length;
    const variance = this.recentValues.reduce((acc, v) => acc + Math.pow(v - mean, 2), 0) / this.recentValues.length;
    const stdDev = Math.sqrt(variance);
    
    // Detectar outlier (> 3 sigma)
    const isOutlier = Math.abs(value - mean) > 3 * stdDev;
    
    if (isOutlier) {
      // Reemplazar outlier con valor interpolado
      return { value: mean, isOutlier: true };
    }
    
    return { value, isOutlier: false };
  }
  
  /**
   * FILTRO PASABANDA COMPLETO
   * HPF 0.5Hz → LPF 4Hz → Savitzky-Golay → Outlier handling
   */
  filter(value: number): number {
    if (!this.initialized || !isFinite(value)) {
      return 0;
    }
    
    // Paso 1: Pasa-altos (elimina DC y deriva lenta)
    const hpFiltered = this.applyBiquad(value, this.hpfB, this.hpfA, this.hpfState);
    
    // Paso 2: Pasa-bajos (elimina ruido de alta frecuencia)
    const bpFiltered = this.applyBiquad(hpFiltered, this.lpfB, this.lpfA, this.lpfState);
    
    // Paso 3: Suavizado Savitzky-Golay (preserva picos)
    const smoothed = this.applySavitzkyGolay(bpFiltered);
    
    // Paso 4: Manejo de outliers
    const { value: finalValue } = this.handleOutlier(smoothed);
    
    return finalValue;
  }
  
  /**
   * Filtrado simple sin S-G ni outliers (para señales ya limpias)
   */
  filterSimple(value: number): number {
    if (!this.initialized || !isFinite(value)) {
      return 0;
    }
    
    const hpFiltered = this.applyBiquad(value, this.hpfB, this.hpfA, this.hpfState);
    const bpFiltered = this.applyBiquad(hpFiltered, this.lpfB, this.lpfA, this.lpfState);
    
    return bpFiltered;
  }
  
  /**
   * Resetear estados del filtro
   */
  reset(): void {
    this.hpfState = { x: [0, 0, 0], y: [0, 0, 0] };
    this.lpfState = { x: [0, 0, 0], y: [0, 0, 0] };
    this.sgBuffer = [];
    this.recentValues = [];
  }
  
  /**
   * Cambiar frecuencia de muestreo
   */
  setSampleRate(rate: number): void {
    this.sampleRate = rate;
    this.computeCoefficients();
    this.reset();
  }
  
  /**
   * Obtener coeficientes actuales (para debug)
   */
  getCoefficients() {
    return {
      highpass: { b: [...this.hpfB], a: [...this.hpfA] },
      lowpass: { b: [...this.lpfB], a: [...this.lpfA] }
    };
  }
}
