/**
 * PPG PROCESSING WEB WORKER
 * 
 * Worker dedicado para procesamiento pesado de señales PPG
 * fuera del hilo principal para mantener UI responsiva.
 * 
 * Funcionalidades:
 * - Procesamiento de frames en paralelo
 * - Cálculos FFT y análisis espectral
 * - Filtrado digital de señales
 * - Detección de picos y análisis morfológico
 * - Cálculo de métricas de calidad
 */

// Importar tipos desde el módulo principal
type PPGSignal = {
  timestamp: number;
  rawR: number;
  rawG: number;
  rawB: number;
  linearR: number;
  linearG: number;
  linearB: number;
  odR: number;
  odG: number;
  odB: number;
};

type WorkerMessage = {
  id: string;
  type: 'PROCESS_FRAME' | 'ANALYZE_SIGNAL' | 'CALCULATE_FFT' | 'FILTER_SIGNAL' | 'DETECT_PEAKS';
  data: any;
};

type WorkerResponse = {
  id: string;
  type: 'SUCCESS' | 'ERROR';
  data?: any;
  error?: string;
};

// Buffers circulares para procesamiento
class CircularBuffer<T> {
  private buffer: T[];
  private size: number;
  private head: number = 0;
  private tail: number = 0;
  private count: number = 0;

  constructor(size: number) {
    this.size = size;
    this.buffer = new Array(size);
  }

  push(item: T): void {
    this.buffer[this.tail] = item;
    this.tail = (this.tail + 1) % this.size;
    if (this.count < this.size) {
      this.count++;
    } else {
      this.head = (this.head + 1) % this.size;
    }
  }

  get(index: number): T {
    if (index >= this.count) throw new Error('Index out of bounds');
    return this.buffer[(this.head + index) % this.size];
  }

  length(): number {
    return this.count;
  }

  toArray(): T[] {
    const result: T[] = [];
    for (let i = 0; i < this.count; i++) {
      result.push(this.get(i));
    }
    return result;
  }

  clear(): void {
    this.head = 0;
    this.tail = 0;
    this.count = 0;
  }
}

// Clase principal del worker
class PPGProcessingWorker {
  private signalBuffer: CircularBuffer<PPGSignal>;
  private readonly BUFFER_SIZE = 600; // 10 segundos a 60 FPS

  constructor() {
    this.signalBuffer = new CircularBuffer<PPGSignal>(this.BUFFER_SIZE);
  }

  /**
   * Procesar un frame individual
   */
  processFrame(imageData: ImageData, roi: { x: number; y: number; width: number; height: number }): PPGSignal {
    const data = imageData.data;
    const w = imageData.width;
    const { x, y, width, height } = roi;

    // Extraer media del ROI
    let sumR = 0, sumG = 0, sumB = 0;
    let pixelCount = 0;

    for (let py = y; py < y + height; py++) {
      for (let px = x; px < x + width; px++) {
        if (px >= 0 && px < w && py >= 0 && py < imageData.height) {
          const idx = (py * w + px) * 4;
          sumR += data[idx];
          sumG += data[idx + 1];
          sumB += data[idx + 2];
          pixelCount++;
        }
      }
    }

    const meanR = pixelCount > 0 ? sumR / pixelCount : 0;
    const meanG = pixelCount > 0 ? sumG / pixelCount : 0;
    const meanB = pixelCount > 0 ? sumB / pixelCount : 0;

    // Convertir a lineal
    const linearR = this.sRGBToLinear(meanR);
    const linearG = this.sRGBToLinear(meanG);
    const linearB = this.sRGBToLinear(meanB);

    // Calcular OD
    const odR = this.opticalDensity(linearR);
    const odG = this.opticalDensity(linearG);
    const odB = this.opticalDensity(linearB);

    const signal: PPGSignal = {
      timestamp: performance.now(),
      rawR: meanR,
      rawG: meanG,
      rawB: meanB,
      linearR,
      linearG,
      linearB,
      odR,
      odG,
      odB,
    };

    // Agregar al buffer
    this.signalBuffer.push(signal);

    return signal;
  }

  /**
   * Analizar señal completa
   */
  analyzeSignal(): {
    acDcRatio: { r: number; g: number; b: number };
    perfusionIndex: number;
    signalQuality: number;
    dominantFrequency: number;
    peaks: number[];
    valleys: number[];
  } {
    if (this.signalBuffer.length() < 30) {
      return {
        acDcRatio: { r: 0, g: 0, b: 0 },
        perfusionIndex: 0,
        signalQuality: 0,
        dominantFrequency: 0,
        peaks: [],
        valleys: [],
      };
    }

    const signals = this.signalBuffer.toArray();
    const rSignal = signals.map(s => s.odR);
    const gSignal = signals.map(s => s.odG);
    const bSignal = signals.map(s => s.odB);

    // Calcular AC/DC
    const dcR = rSignal.reduce((a, b) => a + b, 0) / rSignal.length;
    const dcG = gSignal.reduce((a, b) => a + b, 0) / gSignal.length;
    const dcB = bSignal.reduce((a, b) => a + b, 0) / bSignal.length;

    const acR = Math.sqrt(rSignal.reduce((sum, x) => sum + (x - dcR) ** 2, 0) / rSignal.length);
    const acG = Math.sqrt(gSignal.reduce((sum, x) => sum + (x - dcG) ** 2, 0) / gSignal.length);
    const acB = Math.sqrt(bSignal.reduce((sum, x) => sum + (x - dcB) ** 2, 0) / bSignal.length);

    const acDcRatio = {
      r: dcR > 0 ? acR / dcR : 0,
      g: dcG > 0 ? acG / dcG : 0,
      b: dcB > 0 ? acB / dcB : 0,
    };

    // Índice de perfusión (usar canal verde)
    const perfusionIndex = acDcRatio.g;

    // Calidad de señal (simplificada)
    const signalQuality = this.calculateSignalQuality(gSignal);

    // FFT para frecuencia dominante
    const fftResult = this.calculateFFT(gSignal);
    const dominantFrequency = fftResult.frequencies[fftResult.magnitudes.indexOf(Math.max(...fftResult.magnitudes))];

    // Detección de picos y valles
    const filteredSignal = this.applyBandpassFilter(gSignal);
    const peaks = this.detectPeaks(filteredSignal);
    const valleys = this.detectValleys(filteredSignal);

    return {
      acDcRatio,
      perfusionIndex,
      signalQuality,
      dominantFrequency,
      peaks,
      valleys,
    };
  }

  /**
   * Calcular FFT de una señal
   */
  calculateFFT(signal: number[]): { frequencies: number[]; magnitudes: number[] } {
    const n = signal.length;
    const frequencies: number[] = [];
    const magnitudes: number[] = [];

    // Implementación simplificada de FFT
    for (let k = 0; k < n / 2; k++) {
      let real = 0;
      let imag = 0;

      for (let i = 0; i < n; i++) {
        const angle = -2 * Math.PI * k * i / n;
        real += signal[i] * Math.cos(angle);
        imag += signal[i] * Math.sin(angle);
      }

      frequencies.push(k * 1800 / n); // Convertir a BPM (asumiendo 30 FPS)
      magnitudes.push(Math.sqrt(real * real + imag * imag) / n);
    }

    return { frequencies, magnitudes };
  }

  /**
   * Aplicar filtro paso banda
   */
  applyBandpassFilter(signal: number[]): number[] {
    const fs = 30; // FPS asumido
    const lowFreq = 0.5; // 30 BPM
    const highFreq = 4.0; // 240 BPM

    // Filtro FIR simplificado
    const coefficients = [0.2, 0.3, 0.4, 0.3, 0.2];
    const result: number[] = [];

    for (let i = 0; i < signal.length; i++) {
      let sum = 0;
      for (let j = 0; j < coefficients.length; j++) {
        const idx = i - Math.floor(coefficients.length / 2) + j;
        if (idx >= 0 && idx < signal.length) {
          sum += signal[idx] * coefficients[j];
        }
      }
      result.push(sum);
    }

    return result;
  }

  /**
   * Detectar picos en la señal
   */
  detectPeaks(signal: number[]): number[] {
    const peaks: number[] = [];
    const minDistance = 10; // muestras
    const minHeight = 0.1;

    for (let i = minDistance; i < signal.length - minDistance; i++) {
      const current = signal[i];

      if (current < minHeight) continue;

      let isPeak = true;
      for (let j = i - minDistance; j <= i + minDistance; j++) {
        if (signal[j] > current) {
          isPeak = false;
          break;
        }
      }

      if (isPeak) {
        peaks.push(i);
        i += minDistance;
      }
    }

    return peaks;
  }

  /**
   * Detectar valles en la señal
   */
  detectValleys(signal: number[]): number[] {
    const valleys: number[] = [];
    const minDistance = 10;

    for (let i = minDistance; i < signal.length - minDistance; i++) {
      const current = signal[i];

      let isValley = true;
      for (let j = i - minDistance; j <= i + minDistance; j++) {
        if (signal[j] < current) {
          isValley = false;
          break;
        }
      }

      if (isValley) {
        valleys.push(i);
        i += minDistance;
      }
    }

    return valleys;
  }

  /**
   * Calcular calidad de señal
   */
  private calculateSignalQuality(signal: number[]): number {
    if (signal.length < 10) return 0;

    // Varianza de la señal
    const mean = signal.reduce((a, b) => a + b, 0) / signal.length;
    const variance = signal.reduce((sum, x) => sum + (x - mean) ** 2, 0) / signal.length;

    // Relación señal/ruido simplificada
    const signalPower = variance;
    const noisePower = this.estimateNoise(signal);
    const snr = noisePower > 0 ? signalPower / noisePower : 0;

    // Normalizar a 0..1
    return Math.min(1, snr / 10);
  }

  /**
   * Estimar nivel de ruido
   */
  private estimateNoise(signal: number[]): number {
    // Usar diferencias entre muestras consecutivas como estimación de ruido
    let noiseSum = 0;
    for (let i = 1; i < signal.length; i++) {
      const diff = signal[i] - signal[i - 1];
      noiseSum += diff * diff;
    }
    return noiseSum / (signal.length - 1);
  }

  /**
   * Conversión sRGB a lineal
   */
  private sRGBToLinear(srgb: number): number {
    const v = srgb / 255;
    if (v <= 0.04045) {
      return v / 12.92;
    }
    return Math.pow((v + 0.055) / 1.055, 2.4);
  }

  /**
   * Conversión a densidad óptica
   */
  private opticalDensity(normalized: number): number {
    return -Math.log(Math.max(normalized, 1e-6));
  }

  /**
   * Limpiar buffers
   */
  clear(): void {
    this.signalBuffer.clear();
  }
}

// Instancia del worker
const worker = new PPGProcessingWorker();

// Manejar mensajes del hilo principal
self.onmessage = (event: MessageEvent<WorkerMessage>) => {
  const { id, type, data } = event.data;

  try {
    let result: any;

    switch (type) {
      case 'PROCESS_FRAME':
        result = worker.processFrame(data.imageData, data.roi);
        break;

      case 'ANALYZE_SIGNAL':
        result = worker.analyzeSignal();
        break;

      case 'CALCULATE_FFT':
        result = worker.calculateFFT(data.signal);
        break;

      case 'FILTER_SIGNAL':
        result = worker.applyBandpassFilter(data.signal);
        break;

      case 'DETECT_PEAKS':
        result = {
          peaks: worker.detectPeaks(data.signal),
          valleys: worker.detectValleys(data.signal),
        };
        break;

      default:
        throw new Error(`Unknown message type: ${type}`);
    }

    // Enviar respuesta exitosa
    const response: WorkerResponse = {
      id,
      type: 'SUCCESS',
      data: result,
    };

    self.postMessage(response);

  } catch (error) {
    // Enviar respuesta de error
    const response: WorkerResponse = {
      id,
      type: 'ERROR',
      error: error instanceof Error ? error.message : String(error),
    };

    self.postMessage(response);
  }
};

// Exportar tipos para TypeScript
export type { WorkerMessage, WorkerResponse };
