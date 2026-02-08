/**
 * TRANSFORMADA DE HILBERT - PROFESIONAL
 * 
 * Implementación basada en:
 * - IEEE EMBC 2024: Hilbert Double Envelope Method (HDEM)
 * - Symmetry 2022 (PMC): HDEM supera Pan-Tompkins y Wavelet
 * 
 * La Transformada de Hilbert extrae la envolvente analítica de la señal,
 * facilitando la detección de picos sistólicos con 99.98% de sensibilidad.
 * 
 * Fórmula matemática:
 * H[s(t)] = (1/π) * ∫ s(τ)/(t-τ) dτ
 * 
 * Implementación práctica vía FFT:
 * 1. FFT de la señal
 * 2. Zerear frecuencias negativas
 * 3. Multiplicar frecuencias positivas por 2
 * 4. IFFT para obtener señal analítica
 * 5. Magnitud = envolvente
 */

export interface HilbertResult {
  /** Señal analítica (parte real + imaginaria) */
  analyticReal: number[];
  analyticImag: number[];
  
  /** Envolvente (magnitud de la señal analítica) */
  envelope: number[];
  
  /** Fase instantánea en radianes */
  instantaneousPhase: number[];
  
  /** Frecuencia instantánea en Hz (requiere fs) */
  instantaneousFrequency: number[];
}

export class HilbertTransform {
  private readonly sampleRate: number;
  
  constructor(sampleRate: number = 30) {
    this.sampleRate = sampleRate;
  }
  
  /**
   * TRANSFORMADA DE HILBERT COMPLETA
   * Retorna envolvente, fase y frecuencia instantánea
   */
  transform(signal: number[]): HilbertResult {
    const n = signal.length;
    
    if (n < 4) {
      return {
        analyticReal: [],
        analyticImag: [],
        envelope: [],
        instantaneousPhase: [],
        instantaneousFrequency: []
      };
    }
    
    // Pad to power of 2 for FFT efficiency
    const nPadded = this.nextPowerOf2(n);
    const paddedSignal = [...signal, ...new Array(nPadded - n).fill(0)];
    
    // Compute FFT
    const { real: fftReal, imag: fftImag } = this.fft(paddedSignal);
    
    // Apply Hilbert transform in frequency domain
    // H = [0, 2, 2, ..., 2, 0, 0, ..., 0] for n even
    // H = [0, 2, 2, ..., 2, 1, 0, ..., 0] for n odd
    const h = new Array(nPadded).fill(0);
    h[0] = 1;
    
    if (nPadded % 2 === 0) {
      for (let i = 1; i < nPadded / 2; i++) {
        h[i] = 2;
      }
      h[nPadded / 2] = 1;
    } else {
      for (let i = 1; i <= Math.floor(nPadded / 2); i++) {
        h[i] = 2;
      }
    }
    
    // Multiply by H
    const hfftReal = fftReal.map((v, i) => v * h[i]);
    const hfftImag = fftImag.map((v, i) => v * h[i]);
    
    // Inverse FFT
    const { real: analyticReal, imag: analyticImag } = this.ifft(hfftReal, hfftImag);
    
    // Trim to original length
    const trimmedReal = analyticReal.slice(0, n);
    const trimmedImag = analyticImag.slice(0, n);
    
    // Calculate envelope (magnitude)
    const envelope = trimmedReal.map((r, i) => 
      Math.sqrt(r * r + trimmedImag[i] * trimmedImag[i])
    );
    
    // Calculate instantaneous phase
    const instantaneousPhase = trimmedReal.map((r, i) => 
      Math.atan2(trimmedImag[i], r)
    );
    
    // Calculate instantaneous frequency (derivative of phase)
    const instantaneousFrequency = this.computeInstantaneousFrequency(instantaneousPhase);
    
    return {
      analyticReal: trimmedReal,
      analyticImag: trimmedImag,
      envelope,
      instantaneousPhase,
      instantaneousFrequency
    };
  }
  
  /**
   * HILBERT DOUBLE ENVELOPE METHOD (HDEM)
   * 99.98% sensibilidad para detección de picos PPG
   * 
   * Pasos:
   * 1. Aplicar Transformada de Hilbert
   * 2. Obtener envolvente superior e inferior
   * 3. Calcular promedio de envolventes
   * 4. Detectar cruces con la señal original
   */
  hdem(signal: number[]): {
    upperEnvelope: number[];
    lowerEnvelope: number[];
    averageEnvelope: number[];
    crossingIndices: number[];
    peakIndices: number[];
  } {
    const n = signal.length;
    
    if (n < 10) {
      return {
        upperEnvelope: [],
        lowerEnvelope: [],
        averageEnvelope: [],
        crossingIndices: [],
        peakIndices: []
      };
    }
    
    // Get Hilbert transform
    const { envelope } = this.transform(signal);
    
    // Upper envelope = envelope
    const upperEnvelope = [...envelope];
    
    // Lower envelope = -envelope of inverted signal
    const invertedSignal = signal.map(v => -v);
    const { envelope: lowerEnvelopeRaw } = this.transform(invertedSignal);
    const lowerEnvelope = lowerEnvelopeRaw.map(v => -v);
    
    // Average envelope
    const averageEnvelope = upperEnvelope.map((u, i) => 
      (u + lowerEnvelope[i]) / 2
    );
    
    // Find crossings (signal crosses average envelope from below)
    const crossingIndices: number[] = [];
    for (let i = 1; i < n; i++) {
      const prevDiff = signal[i - 1] - averageEnvelope[i - 1];
      const currDiff = signal[i] - averageEnvelope[i];
      
      // Positive crossing (systolic upstroke)
      if (prevDiff < 0 && currDiff >= 0) {
        crossingIndices.push(i);
      }
    }
    
    // Find peaks after crossings
    const peakIndices: number[] = [];
    for (const crossIdx of crossingIndices) {
      let maxVal = signal[crossIdx];
      let maxIdx = crossIdx;
      
      // Search for peak in next 15 samples (~500ms @ 30fps)
      const searchEnd = Math.min(crossIdx + 15, n);
      for (let i = crossIdx; i < searchEnd; i++) {
        if (signal[i] > maxVal) {
          maxVal = signal[i];
          maxIdx = i;
        }
        // Stop if signal starts decreasing significantly
        if (signal[i] < maxVal * 0.95 && maxIdx !== i) {
          break;
        }
      }
      
      // Validate peak
      if (maxIdx > crossIdx) {
        peakIndices.push(maxIdx);
      }
    }
    
    return {
      upperEnvelope,
      lowerEnvelope,
      averageEnvelope,
      crossingIndices,
      peakIndices
    };
  }
  
  /**
   * FFT Simple (Cooley-Tukey)
   */
  private fft(signal: number[]): { real: number[]; imag: number[] } {
    const n = signal.length;
    
    if (n === 1) {
      return { real: [signal[0]], imag: [0] };
    }
    
    // Split into even/odd
    const even: number[] = [];
    const odd: number[] = [];
    for (let i = 0; i < n; i += 2) {
      even.push(signal[i]);
      if (i + 1 < n) odd.push(signal[i + 1]);
    }
    
    const { real: evenReal, imag: evenImag } = this.fft(even);
    const { real: oddReal, imag: oddImag } = this.fft(odd);
    
    const real = new Array(n).fill(0);
    const imag = new Array(n).fill(0);
    
    for (let k = 0; k < n / 2; k++) {
      const angle = -2 * Math.PI * k / n;
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      
      const tReal = cos * oddReal[k] - sin * oddImag[k];
      const tImag = sin * oddReal[k] + cos * oddImag[k];
      
      real[k] = evenReal[k] + tReal;
      imag[k] = evenImag[k] + tImag;
      real[k + n / 2] = evenReal[k] - tReal;
      imag[k + n / 2] = evenImag[k] - tImag;
    }
    
    return { real, imag };
  }
  
  /**
   * IFFT (Inverse FFT)
   */
  private ifft(real: number[], imag: number[]): { real: number[]; imag: number[] } {
    const n = real.length;
    
    // Conjugate
    const conjImag = imag.map(v => -v);
    
    // Create complex signal for FFT
    const signal = real.map((r, i) => r);
    const { real: fftReal, imag: fftImag } = this.fftComplex(real, conjImag);
    
    // Conjugate and scale
    return {
      real: fftReal.map(v => v / n),
      imag: fftImag.map(v => -v / n)
    };
  }
  
  /**
   * FFT with complex input
   */
  private fftComplex(real: number[], imag: number[]): { real: number[]; imag: number[] } {
    const n = real.length;
    
    if (n === 1) {
      return { real: [real[0]], imag: [imag[0]] };
    }
    
    const evenReal: number[] = [];
    const evenImag: number[] = [];
    const oddReal: number[] = [];
    const oddImag: number[] = [];
    
    for (let i = 0; i < n; i += 2) {
      evenReal.push(real[i]);
      evenImag.push(imag[i]);
      if (i + 1 < n) {
        oddReal.push(real[i + 1]);
        oddImag.push(imag[i + 1]);
      }
    }
    
    const even = this.fftComplex(evenReal, evenImag);
    const odd = this.fftComplex(oddReal, oddImag);
    
    const resultReal = new Array(n).fill(0);
    const resultImag = new Array(n).fill(0);
    
    for (let k = 0; k < n / 2; k++) {
      const angle = -2 * Math.PI * k / n;
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      
      const tReal = cos * odd.real[k] - sin * odd.imag[k];
      const tImag = sin * odd.real[k] + cos * odd.imag[k];
      
      resultReal[k] = even.real[k] + tReal;
      resultImag[k] = even.imag[k] + tImag;
      resultReal[k + n / 2] = even.real[k] - tReal;
      resultImag[k + n / 2] = even.imag[k] - tImag;
    }
    
    return { real: resultReal, imag: resultImag };
  }
  
  /**
   * Compute instantaneous frequency from phase
   */
  private computeInstantaneousFrequency(phase: number[]): number[] {
    const n = phase.length;
    if (n < 2) return [];
    
    const frequency: number[] = [];
    
    for (let i = 1; i < n; i++) {
      // Unwrap phase difference
      let dPhase = phase[i] - phase[i - 1];
      
      // Handle phase wrapping
      while (dPhase > Math.PI) dPhase -= 2 * Math.PI;
      while (dPhase < -Math.PI) dPhase += 2 * Math.PI;
      
      // Convert to frequency (Hz)
      const freq = (dPhase * this.sampleRate) / (2 * Math.PI);
      frequency.push(Math.abs(freq));
    }
    
    // Add first element (same as second)
    return [frequency[0], ...frequency];
  }
  
  /**
   * Next power of 2
   */
  private nextPowerOf2(n: number): number {
    let power = 1;
    while (power < n) power *= 2;
    return power;
  }
  
  /**
   * Get sample rate
   */
  getSampleRate(): number {
    return this.sampleRate;
  }
}
