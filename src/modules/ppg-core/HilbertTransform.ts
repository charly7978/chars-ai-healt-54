/**
 * TRANSFORMADA DE HILBERT - FFT-BASED
 * 
 * Extrae la señal analítica y envolvente instantánea
 * para detección de picos con HDEM (Hilbert Double Envelope Method)
 * 
 * Algoritmo:
 * 1. FFT de la señal
 * 2. Multiplicar por H[k]: 1 en DC, 2 en frecuencias positivas, 0 en negativas
 * 3. IFFT para obtener señal analítica (compleja)
 * 4. Magnitud = envolvente instantánea
 * 5. Ángulo = fase instantánea
 * 
 * Referencia: Chakraborty et al., Symmetry 2022 - HDEM para PPG
 * Sensibilidad: 99.98% vs 99.82% de zero-crossing
 */

interface Complex {
  real: number;
  imag: number;
}

export interface HilbertResult {
  envelope: number[];           // Envolvente instantánea (magnitud)
  phase: number[];              // Fase instantánea (radianes)
  analyticSignal: Complex[];    // Señal analítica completa
  instantaneousFrequency: number[]; // Frecuencia instantánea (Hz)
}

export class HilbertTransform {
  private sampleRate: number;
  
  constructor(sampleRate: number = 30) {
    this.sampleRate = sampleRate;
  }
  
  /**
   * TRANSFORMADA DE HILBERT COMPLETA
   * Retorna envolvente, fase y señal analítica
   */
  transform(signal: number[]): HilbertResult {
    const n = signal.length;
    
    if (n === 0) {
      return {
        envelope: [],
        phase: [],
        analyticSignal: [],
        instantaneousFrequency: []
      };
    }
    
    // Padding a potencia de 2 para FFT eficiente
    const paddedLength = this.nextPowerOf2(n);
    const paddedSignal = new Array(paddedLength).fill(0);
    for (let i = 0; i < n; i++) {
      paddedSignal[i] = signal[i];
    }
    
    // 1. FFT de la señal
    const X = this.fft(paddedSignal);
    
    // 2. Crear filtro de Hilbert H[k]
    // H[0] = 1 (DC)
    // H[1..N/2-1] = 2 (frecuencias positivas)
    // H[N/2] = 1 (Nyquist)
    // H[N/2+1..N-1] = 0 (frecuencias negativas)
    const H: Complex[] = new Array(paddedLength);
    const halfN = paddedLength / 2;
    
    for (let k = 0; k < paddedLength; k++) {
      if (k === 0 || k === halfN) {
        H[k] = { real: X[k].real, imag: X[k].imag };
      } else if (k < halfN) {
        H[k] = { real: 2 * X[k].real, imag: 2 * X[k].imag };
      } else {
        H[k] = { real: 0, imag: 0 };
      }
    }
    
    // 3. IFFT para obtener señal analítica
    const analyticFull = this.ifft(H);
    
    // Recortar al tamaño original
    const analyticSignal: Complex[] = analyticFull.slice(0, n);
    
    // 4. Calcular envolvente (magnitud)
    const envelope: number[] = new Array(n);
    for (let i = 0; i < n; i++) {
      envelope[i] = Math.sqrt(
        analyticSignal[i].real ** 2 + analyticSignal[i].imag ** 2
      );
    }
    
    // 5. Calcular fase instantánea
    const phase: number[] = new Array(n);
    for (let i = 0; i < n; i++) {
      phase[i] = Math.atan2(analyticSignal[i].imag, analyticSignal[i].real);
    }
    
    // 6. Calcular frecuencia instantánea (derivada de fase)
    const instantaneousFrequency = this.computeInstantaneousFrequency(phase);
    
    return {
      envelope,
      phase,
      analyticSignal,
      instantaneousFrequency
    };
  }
  
  /**
   * Obtener solo la envolvente (más eficiente si solo se necesita esto)
   */
  getEnvelope(signal: number[]): number[] {
    return this.transform(signal).envelope;
  }
  
  /**
   * HDEM - Hilbert Double Envelope Method
   * Aplica Hilbert dos veces para obtener threshold adaptativo
   */
  doubleEnvelope(signal: number[]): {
    envelope1: number[];
    envelope2: number[];
    threshold: number[];
  } {
    // Primera envolvente
    const envelope1 = this.getEnvelope(signal);
    
    // Segunda envolvente (aplicar Hilbert a la primera envolvente)
    const envelope2 = this.getEnvelope(envelope1);
    
    // Threshold = promedio de ambas envolventes
    const threshold: number[] = new Array(signal.length);
    for (let i = 0; i < signal.length; i++) {
      threshold[i] = (envelope1[i] + envelope2[i]) / 2;
    }
    
    return { envelope1, envelope2, threshold };
  }
  
  /**
   * Calcular frecuencia instantánea desde la fase
   */
  private computeInstantaneousFrequency(phase: number[]): number[] {
    const n = phase.length;
    if (n < 2) return [];
    
    const freq: number[] = new Array(n);
    freq[0] = 0;
    
    for (let i = 1; i < n; i++) {
      // Unwrap phase para evitar discontinuidades
      let dPhase = phase[i] - phase[i - 1];
      
      // Normalizar a [-π, π]
      while (dPhase > Math.PI) dPhase -= 2 * Math.PI;
      while (dPhase < -Math.PI) dPhase += 2 * Math.PI;
      
      // Frecuencia = derivada de fase / (2π) * sampleRate
      freq[i] = (dPhase / (2 * Math.PI)) * this.sampleRate;
    }
    
    return freq;
  }
  
  /**
   * FFT (Cooley-Tukey radix-2)
   */
  private fft(signal: number[]): Complex[] {
    const n = signal.length;
    
    // Caso base
    if (n === 1) {
      return [{ real: signal[0], imag: 0 }];
    }
    
    // Dividir en pares e impares
    const even: number[] = [];
    const odd: number[] = [];
    for (let i = 0; i < n; i++) {
      if (i % 2 === 0) {
        even.push(signal[i]);
      } else {
        odd.push(signal[i]);
      }
    }
    
    // FFT recursiva
    const evenFFT = this.fft(even);
    const oddFFT = this.fft(odd);
    
    // Combinar
    const result: Complex[] = new Array(n);
    const halfN = n / 2;
    
    for (let k = 0; k < halfN; k++) {
      const angle = -2 * Math.PI * k / n;
      const twiddle: Complex = {
        real: Math.cos(angle),
        imag: Math.sin(angle)
      };
      
      // t = twiddle * oddFFT[k]
      const t: Complex = {
        real: twiddle.real * oddFFT[k].real - twiddle.imag * oddFFT[k].imag,
        imag: twiddle.real * oddFFT[k].imag + twiddle.imag * oddFFT[k].real
      };
      
      result[k] = {
        real: evenFFT[k].real + t.real,
        imag: evenFFT[k].imag + t.imag
      };
      
      result[k + halfN] = {
        real: evenFFT[k].real - t.real,
        imag: evenFFT[k].imag - t.imag
      };
    }
    
    return result;
  }
  
  /**
   * IFFT (inversa de FFT)
   */
  private ifft(X: Complex[]): Complex[] {
    const n = X.length;
    
    // Conjugar entrada
    const conjugated: number[] = new Array(n);
    for (let i = 0; i < n; i++) {
      // Para IFFT, usamos solo la parte real de la señal transformada
      // después de conjugar y aplicar FFT
      conjugated[i] = X[i].real;
    }
    
    // Crear señal compleja conjugada
    const conjX: Complex[] = X.map(x => ({ real: x.real, imag: -x.imag }));
    
    // Convertir a array de reales para FFT
    const realArray: number[] = [];
    for (let i = 0; i < n; i++) {
      realArray.push(conjX[i].real);
    }
    
    // Aplicar FFT con señal compleja manualmente
    const result = this.fftComplex(conjX);
    
    // Conjugar resultado y dividir por n
    return result.map(x => ({
      real: x.real / n,
      imag: -x.imag / n
    }));
  }
  
  /**
   * FFT para señales complejas
   */
  private fftComplex(signal: Complex[]): Complex[] {
    const n = signal.length;
    
    if (n === 1) {
      return [{ ...signal[0] }];
    }
    
    const even: Complex[] = [];
    const odd: Complex[] = [];
    for (let i = 0; i < n; i++) {
      if (i % 2 === 0) {
        even.push(signal[i]);
      } else {
        odd.push(signal[i]);
      }
    }
    
    const evenFFT = this.fftComplex(even);
    const oddFFT = this.fftComplex(odd);
    
    const result: Complex[] = new Array(n);
    const halfN = n / 2;
    
    for (let k = 0; k < halfN; k++) {
      const angle = -2 * Math.PI * k / n;
      const twiddle: Complex = {
        real: Math.cos(angle),
        imag: Math.sin(angle)
      };
      
      const t: Complex = {
        real: twiddle.real * oddFFT[k].real - twiddle.imag * oddFFT[k].imag,
        imag: twiddle.real * oddFFT[k].imag + twiddle.imag * oddFFT[k].real
      };
      
      result[k] = {
        real: evenFFT[k].real + t.real,
        imag: evenFFT[k].imag + t.imag
      };
      
      result[k + halfN] = {
        real: evenFFT[k].real - t.real,
        imag: evenFFT[k].imag - t.imag
      };
    }
    
    return result;
  }
  
  /**
   * Siguiente potencia de 2
   */
  private nextPowerOf2(n: number): number {
    let power = 1;
    while (power < n) {
      power *= 2;
    }
    return power;
  }
  
  /**
   * Actualizar sample rate
   */
  setSampleRate(rate: number): void {
    this.sampleRate = rate;
  }
}
