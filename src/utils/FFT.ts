/**
 * Implementación de la Transformada Rápida de Fourier (FFT)
 * para análisis espectral de señales PPG.
 */
export class FFT {
  private size: number;
  private sizeLog2: number;
  private reversed: Uint32Array;
  private sinTable: Float32Array;
  private cosTable: Float32Array;
  
  /**
   * Crea una nueva instancia de FFT
   * @param size Tamaño de la FFT (debe ser potencia de 2)
   */
  constructor(size: number) {
    if ((size & (size - 1)) !== 0) {
      throw new Error('El tamaño de la FFT debe ser una potencia de 2');
    }
    
    this.size = size;
    this.sizeLog2 = Math.log2(size);
    
    if (Math.pow(2, this.sizeLog2) !== size) {
      throw new Error('El tamaño de la FFT debe ser una potencia de 2');
    }
    
    // Precalcular tablas de seno y coseno
    this.sinTable = new Float32Array(size);
    this.cosTable = new Float32Array(size);
    
    for (let i = 0; i < size; i++) {
      const angle = -2 * Math.PI * i / size;
      this.sinTable[i] = Math.sin(angle);
      this.cosTable[i] = Math.cos(angle);
    }
    
    // Precalcular índices invertidos en bit
    this.reversed = new Uint32Array(size);
    for (let i = 0; i < size; i++) {
      let reversed = 0;
      let temp = i;
      
      for (let j = 0; j < this.sizeLog2; j++) {
        reversed = (reversed << 1) | (temp & 1);
        temp >>>= 1;
      }
      
      this.reversed[i] = reversed;
    }
  }
  
  /**
   * Realiza la FFT en el dominio del tiempo
   * @param real Parte real de la señal de entrada
   * @param imag Parte imaginaria de la señal de entrada (puede ser nula)
   * @returns Arreglo con la parte real e imaginaria del espectro [re0, im0, re1, im1, ...]
   */
  forward(real: Float32Array, imag: Float32Array | null = null): Float32Array {
    const n = this.size;
    const output = new Float32Array(n * 2);
    
    // Inicializar salida con los datos de entrada
    for (let i = 0; i < n; i++) {
      const idx = this.reversed[i];
      output[2 * i] = real[idx];
      output[2 * i + 1] = imag ? imag[idx] : 0;
    }
    
    // Algoritmo FFT de Cooley-Tukey
    for (let s = 1; s <= this.sizeLog2; s++) {
      const m = 1 << s; // 2^s
      const m2 = m >>> 1; // m/2
      
      for (let k = 0; k < n; k += m) {
        for (let j = 0; j < m2; j++) {
          const idx = j * (n / m);
          const cos = this.cosTable[idx];
          const sin = this.sinTable[idx];
          
          const p = k + j;
          const q = p + m2;
          
          const re = output[2 * q] * cos - output[2 * q + 1] * sin;
          const im = output[2 * q] * sin + output[2 * q + 1] * cos;
          
          const tRe = output[2 * p];
          const tIm = output[2 * p + 1];
          
          output[2 * p] = tRe + re;
          output[2 * p + 1] = tIm + im;
          output[2 * q] = tRe - re;
          output[2 * q + 1] = tIm - im;
        }
      }
    }
    
    return output;
  }
  
  /**
   * Calcula la magnitud del espectro
   * @param fftOutput Salida del método forward()
   * @returns Arreglo con las magnitudes del espectro
   */
  magnitude(fftOutput: Float32Array): Float32Array {
    const n = this.size;
    const mag = new Float32Array(n / 2); // Solo la mitad es simétrica
    
    for (let i = 0; i < n / 2; i++) {
      const re = fftOutput[2 * i];
      const im = fftOutput[2 * i + 1];
      mag[i] = Math.sqrt(re * re + im * im);
    }
    
    return mag;
  }
  
  /**
   * Calcula la densidad espectral de potencia (PSD)
   * @param fftOutput Salida del método forward()
   * @returns Arreglo con la PSD
   */
  powerSpectralDensity(fftOutput: Float32Array): Float32Array {
    const n = this.size;
    const psd = new Float32Array(n / 2);
    const scale = 1 / (n * n); // Factor de escala para la PSD
    
    for (let i = 0; i < n / 2; i++) {
      const re = fftOutput[2 * i];
      const im = fftOutput[2 * i + 1];
      psd[i] = (re * re + im * im) * scale;
    }
    
    return psd;
  }
  
  /**
   * Calcula la frecuencia correspondiente a cada bin del espectro
   * @param sampleRate Frecuencia de muestreo en Hz
   * @returns Arreglo con las frecuencias en Hz
   */
  frequencies(sampleRate: number): Float32Array {
    const n = this.size;
    const freqs = new Float32Array(n / 2);
    
    for (let i = 0; i < n / 2; i++) {
      freqs[i] = (i * sampleRate) / n;
    }
    
    return freqs;
  }
  
  /**
   * Aplica una ventana a la señal para reducir el efecto de fuga espectral
   * @param signal Señal de entrada
   * @param windowType Tipo de ventana ('hamming', 'hann', 'blackman')
   * @returns Señal con la ventana aplicada
   */
  static applyWindow(signal: Float32Array, windowType: 'hamming' | 'hann' | 'blackman'): Float32Array {
    const n = signal.length;
    const windowed = new Float32Array(n);
    
    for (let i = 0; i < n; i++) {
      let w = 1;
      
      switch (windowType) {
        case 'hamming':
          w = 0.54 - 0.46 * Math.cos((2 * Math.PI * i) / (n - 1));
          break;
        case 'hann':
          w = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (n - 1)));
          break;
        case 'blackman':
          w = 0.42 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1)) + 
              0.08 * Math.cos((4 * Math.PI * i) / (n - 1));
          break;
      }
      
      windowed[i] = signal[i] * w;
    }
    
    return windowed;
  }
  
  /**
   * Calcula la potencia en bandas de frecuencia específicas
   * @param psd Densidad espectral de potencia
   * @param freqs Frecuencias correspondientes a cada bin
   * @param bands Array de bandas [min1, max1, min2, max2, ...] en Hz
   * @returns Array con la potencia en cada banda
   */
  static bandPower(
    psd: Float32Array, 
    freqs: Float32Array, 
    bands: number[]
  ): { band: [number, number]; power: number }[] {
    const result: { band: [number, number]; power: number }[] = [];
    
    for (let i = 0; i < bands.length - 1; i += 2) {
      const minFreq = bands[i];
      const maxFreq = bands[i + 1];
      let power = 0;
      let count = 0;
      
      for (let j = 0; j < freqs.length; j++) {
        if (freqs[j] >= minFreq && freqs[j] <= maxFreq) {
          power += psd[j];
          count++;
        }
      }
      
      result.push({
        band: [minFreq, maxFreq],
        power: count > 0 ? power / count : 0
      });
    }
    
    return result;
  }
}
