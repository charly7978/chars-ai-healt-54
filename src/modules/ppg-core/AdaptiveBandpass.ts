/**
 * FILTRO PASABANDA ADAPTATIVO CON NOTCH
 * 
 * Mejoras sobre BandpassFilter.ts:
 * 1. Filtro Notch 50/60Hz para eliminar ruido eléctrico
 * 2. Pasabanda 0.4-4.5Hz para HR (24-270 BPM)
 * 3. Orden configurable (2do o 4to orden)
 * 4. Coeficientes optimizados para PPG de cámara
 * 
 * Referencias:
 * - IEEE EMBC 2024: Butterworth 0.5-4Hz óptimo para PPG
 * - Texas Instruments SLAA655: Filtrado para pulsioximetría
 */

export class AdaptiveBandpass {
  private sampleRate: number;
  
  // Coeficientes del filtro pasa-altos
  private hpfB: number[] = [0, 0, 0];
  private hpfA: number[] = [1, 0, 0];
  
  // Coeficientes del filtro pasa-bajos
  private lpfB: number[] = [0, 0, 0];
  private lpfA: number[] = [1, 0, 0];
  
  // Coeficientes del filtro notch 50Hz
  private notch50B: number[] = [1, 0, 0];
  private notch50A: number[] = [1, 0, 0];
  
  // Coeficientes del filtro notch 60Hz
  private notch60B: number[] = [1, 0, 0];
  private notch60A: number[] = [1, 0, 0];
  
  // Estados internos
  private hpfState = { x: [0, 0, 0], y: [0, 0, 0] };
  private lpfState = { x: [0, 0, 0], y: [0, 0, 0] };
  private notch50State = { x: [0, 0, 0], y: [0, 0, 0] };
  private notch60State = { x: [0, 0, 0], y: [0, 0, 0] };
  
  // Configuración
  private enableNotch: boolean = true;
  private filterOrder: 2 | 4 = 2;
  
  // Segunda etapa para filtro de 4to orden
  private hpf2State = { x: [0, 0, 0], y: [0, 0, 0] };
  private lpf2State = { x: [0, 0, 0], y: [0, 0, 0] };
  
  constructor(
    sampleRate: number = 30,
    options?: { enableNotch?: boolean; filterOrder?: 2 | 4 }
  ) {
    this.sampleRate = sampleRate;
    
    if (options?.enableNotch !== undefined) {
      this.enableNotch = options.enableNotch;
    }
    if (options?.filterOrder !== undefined) {
      this.filterOrder = options.filterOrder;
    }
    
    this.computeCoefficients();
  }
  
  /**
   * CALCULAR COEFICIENTES
   */
  private computeCoefficients(): void {
    const fs = this.sampleRate;
    
    // === PASA-ALTOS a 0.4Hz (permite hasta 24 BPM) ===
    const fcHp = 0.4;
    this.computeButterworthHP(fcHp, fs);
    
    // === PASA-BAJOS a 4.5Hz (hasta 270 BPM) ===
    const fcLp = 4.5;
    this.computeButterworthLP(fcLp, fs);
    
    // === NOTCH 50Hz (si fs > 100Hz, de lo contrario omitir) ===
    if (this.enableNotch && fs > 100) {
      this.computeNotch(50, fs, this.notch50B, this.notch50A);
      this.computeNotch(60, fs, this.notch60B, this.notch60A);
    }
  }
  
  /**
   * Butterworth Pasa-Altos 2do orden
   */
  private computeButterworthHP(fc: number, fs: number): void {
    const wc = Math.tan(Math.PI * fc / fs);
    const k = wc;
    const norm = 1 / (1 + Math.sqrt(2) * k + k * k);
    
    this.hpfB[0] = norm;
    this.hpfB[1] = -2 * norm;
    this.hpfB[2] = norm;
    this.hpfA[0] = 1;
    this.hpfA[1] = 2 * (k * k - 1) * norm;
    this.hpfA[2] = (1 - Math.sqrt(2) * k + k * k) * norm;
  }
  
  /**
   * Butterworth Pasa-Bajos 2do orden
   */
  private computeButterworthLP(fc: number, fs: number): void {
    const wc = Math.tan(Math.PI * fc / fs);
    const k = wc;
    const norm = 1 / (1 + Math.sqrt(2) * k + k * k);
    
    this.lpfB[0] = k * k * norm;
    this.lpfB[1] = 2 * k * k * norm;
    this.lpfB[2] = k * k * norm;
    this.lpfA[0] = 1;
    this.lpfA[1] = 2 * (k * k - 1) * norm;
    this.lpfA[2] = (1 - Math.sqrt(2) * k + k * k) * norm;
  }
  
  /**
   * Filtro Notch para frecuencia específica
   * Ancho de banda: Q = 30 (muy estrecho)
   */
  private computeNotch(fc: number, fs: number, b: number[], a: number[]): void {
    if (fc >= fs / 2) {
      // Frecuencia de corte >= Nyquist, desactivar
      b[0] = 1; b[1] = 0; b[2] = 0;
      a[0] = 1; a[1] = 0; a[2] = 0;
      return;
    }
    
    const w0 = 2 * Math.PI * fc / fs;
    const Q = 30; // Factor de calidad alto = notch estrecho
    const alpha = Math.sin(w0) / (2 * Q);
    
    const cosW0 = Math.cos(w0);
    
    b[0] = 1;
    b[1] = -2 * cosW0;
    b[2] = 1;
    
    const a0 = 1 + alpha;
    a[0] = 1;
    a[1] = (-2 * cosW0) / a0;
    a[2] = (1 - alpha) / a0;
    
    // Normalizar b
    b[0] /= a0;
    b[1] /= a0;
    b[2] /= a0;
  }
  
  /**
   * APLICAR FILTRO BIQUAD
   */
  private applyBiquad(
    input: number,
    b: number[],
    a: number[],
    state: { x: number[], y: number[] }
  ): number {
    state.x[2] = state.x[1];
    state.x[1] = state.x[0];
    state.x[0] = input;
    
    state.y[2] = state.y[1];
    state.y[1] = state.y[0];
    
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
   * FILTRAR MUESTRA
   * Aplica: [Notch 50/60Hz] -> HPF -> LPF
   */
  filter(value: number): number {
    if (!isFinite(value)) return 0;
    
    let filtered = value;
    
    // 1. Notch 50Hz y 60Hz (si está habilitado y sample rate lo permite)
    if (this.enableNotch && this.sampleRate > 100) {
      filtered = this.applyBiquad(filtered, this.notch50B, this.notch50A, this.notch50State);
      filtered = this.applyBiquad(filtered, this.notch60B, this.notch60A, this.notch60State);
    }
    
    // 2. Pasa-Altos (elimina DC)
    filtered = this.applyBiquad(filtered, this.hpfB, this.hpfA, this.hpfState);
    
    // 2b. Segunda etapa HPF para 4to orden
    if (this.filterOrder === 4) {
      filtered = this.applyBiquad(filtered, this.hpfB, this.hpfA, this.hpf2State);
    }
    
    // 3. Pasa-Bajos (elimina ruido HF)
    filtered = this.applyBiquad(filtered, this.lpfB, this.lpfA, this.lpfState);
    
    // 3b. Segunda etapa LPF para 4to orden
    if (this.filterOrder === 4) {
      filtered = this.applyBiquad(filtered, this.lpfB, this.lpfA, this.lpf2State);
    }
    
    return filtered;
  }
  
  /**
   * FILTRAR ARRAY COMPLETO
   */
  filterArray(signal: number[]): number[] {
    return signal.map(v => this.filter(v));
  }
  
  /**
   * RESET ESTADOS
   */
  reset(): void {
    const resetState = () => ({ x: [0, 0, 0], y: [0, 0, 0] });
    
    this.hpfState = resetState();
    this.lpfState = resetState();
    this.notch50State = resetState();
    this.notch60State = resetState();
    this.hpf2State = resetState();
    this.lpf2State = resetState();
  }
  
  /**
   * CONFIGURAR SAMPLE RATE
   */
  setSampleRate(rate: number): void {
    this.sampleRate = rate;
    this.computeCoefficients();
    this.reset();
  }
  
  /**
   * HABILITAR/DESHABILITAR NOTCH
   */
  setNotchEnabled(enabled: boolean): void {
    this.enableNotch = enabled;
  }
  
  /**
   * CAMBIAR ORDEN DEL FILTRO
   */
  setFilterOrder(order: 2 | 4): void {
    this.filterOrder = order;
    this.reset();
  }
  
  /**
   * OBTENER CONFIGURACIÓN ACTUAL
   */
  getConfig() {
    return {
      sampleRate: this.sampleRate,
      enableNotch: this.enableNotch,
      filterOrder: this.filterOrder,
      hpCutoff: 0.4,
      lpCutoff: 4.5
    };
  }
}
