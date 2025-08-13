import * as tf from '@tensorflow/tfjs';
import { BaseModel, ModelConfig } from './BaseModel';

export interface BloodPressureModelConfig extends ModelConfig {
  signalLength: number;
  samplingRate: number;
  featureExtractionLayers?: number;
}

export interface BloodPressurePrediction {
  systolic: number;
  diastolic: number;
  map: number; // Mean Arterial Pressure
  confidence: number;
  features: {
    pulseWaveVelocity?: number;
    augmentationIndex?: number;
    reflectionIndex?: number;
  };
}

export class BloodPressureModel extends BaseModel {
  private signalLength: number;
  private samplingRate: number;
  private featureExtractionLayers: number;
  private featureExtractor: tf.LayersModel | null = null;

  constructor(config: BloodPressureModelConfig) {
    super({
      ...config,
      outputShape: [2] // [systolic, diastolic]
    }, 'BloodPressureModel');
    
    this.signalLength = config.signalLength;
    this.samplingRate = config.samplingRate;
    this.featureExtractionLayers = config.featureExtractionLayers || 3;
  }

  protected buildModel(): tf.LayersModel {
    const model = tf.sequential();
    
    // Input layer - expecting preprocessed PPG signal
    model.add(tf.layers.inputLayer({
      inputShape: [this.signalLength, 1],
      name: 'input_layer'
    }));

    // Feature extraction using 1D convolutions
    let filters = 32;
    for (let i = 0; i < this.featureExtractionLayers; i++) {
      model.add(tf.layers.conv1d({
        filters,
        kernelSize: 5,
        strides: 1,
        padding: 'same',
        activation: 'relu',
        name: `conv1d_${i + 1}`
      }));
      
      model.add(tf.layers.maxPooling1d({
        poolSize: 2,
        strides: 2,
        name: `max_pool_${i + 1}`
      }));
      
      model.add(tf.layers.batchNormalization({
        name: `batch_norm_${i + 1}`
      }));
      
      filters *= 2;
    }

    // Bidirectional LSTM for temporal pattern recognition
    model.add(tf.layers.bidirectional({
      layer: tf.layers.lstm({
        units: 64,
        returnSequences: false,
        name: 'lstm_1'
      })
    }));

    // Dense layers for final prediction
    model.add(tf.layers.dense({
      units: 64,
      activation: 'relu',
      name: 'dense_1'
    }));
    
    model.add(tf.layers.dropout({
      rate: 0.3,
      name: 'dropout_1'
    }));
    
    // Output layer - predicts systolic and diastolic BP
    model.add(tf.layers.dense({
      units: 2, // [systolic, diastolic]
      activation: 'linear',
      name: 'output_layer'
    }));

    // Compile the model
    model.compile({
      optimizer: tf.train.adam(this.config.learningRate || 0.0005),
      loss: 'meanSquaredError',
      metrics: ['mae']
    });

    return model;
  }

  public async predictBloodPressure(
    ppgSignal: Float32Array,
    ecgSignal?: Float32Array,
    preprocess: boolean = true
  ): Promise<BloodPressurePrediction> {
    // Preprocess the PPG signal
    const processedSignal = preprocess ? 
      this.preprocessSignal(ppgSignal) : 
      ppgSignal;

    // Create input tensor [1, signalLength, 1]
    const inputTensor = tf.tensor3d(
      processedSignal,
      [1, processedSignal.length, 1]
    );

    // Make prediction
    const prediction = await this.model.predict(inputTensor) as tf.Tensor;
    const predictionData = await prediction.data();
    const systolic = predictionData[0];
    const diastolic = predictionData[1];
    
    // Calculate additional features
    const features = this.extractFeatures(processedSignal);
    
    // Calculate confidence based on signal quality and prediction variance
    const confidence = this.calculateConfidence(processedSignal, systolic, diastolic);
    
    // Calculate Mean Arterial Pressure (MAP)
    const map = diastolic + ((systolic - diastolic) / 3);
    
    tf.dispose([inputTensor, prediction]);
    
    return {
      systolic: this.clampBPValue(systolic, 70, 200),
      diastolic: this.clampBPValue(diastolic, 40, 120),
      map: this.clampBPValue(map, 50, 150),
      confidence: Math.max(0, Math.min(1, confidence)),
      features: {
        pulseWaveVelocity: features.pulseWaveVelocity,
        augmentationIndex: features.augmentationIndex,
        reflectionIndex: features.reflectionIndex
      }
    };
  }

  private preprocessSignal(signal: Float32Array): Float32Array {
    // 1. Validación de la señal de entrada
    if (!signal || signal.length === 0) {
      throw new Error('Señal de entrada no válida');
    }

    // 2. Eliminación de línea de base con filtro de paso alto
    const baselineRemoved = this.removeBaselineWander(signal, this.samplingRate);
    
    // 3. Filtro paso banda más preciso (0.67Hz - 5Hz para PPG según estándares médicos)
    const filtered = this.butterworthBandpassFilter(
      baselineRemoved,
      0.67,  // Frecuencia de corte baja (Hz)
      5.0,   // Frecuencia de corte alta (Hz)
      this.samplingRate,
      4      // Orden del filtro
    );
    
    // 4. Detección y corrección de artefactos
    const artifactCorrected = this.correctMotionArtifacts(filtered, this.samplingRate);
    
    // 5. Normalización de señal con escalado robusto
    return this.robustNormalize(artifactCorrected);
  }

  private removeBaselineWander(
    signal: Float32Array,
    sampleRate: number
  ): Float32Array {
    // Implementación de un filtro de paso alto Butterworth de 4to orden
    // Frecuencia de corte de 0.5Hz para eliminar la deriva de la línea de base
    const cutoffFreq = 0.5; // Hz
    const rc = 1.0 / (2 * Math.PI * cutoffFreq);
    const dt = 1.0 / sampleRate;
    const alpha = dt / (rc + dt);
    
    const result = new Float32Array(signal.length);
    let highpass = signal[0];
    
    // Aplicar filtro de paso alto
    for (let i = 1; i < signal.length; i++) {
      highpass = alpha * (highpass + signal[i] - signal[i-1]);
      result[i] = signal[i] - highpass;
    }
    
    // Asegurar que no haya valores NaN o infinitos
    for (let i = 0; i < result.length; i++) {
      if (!isFinite(result[i]) || isNaN(result[i])) {
        result[i] = 0;
      }
    }
    
    return result;
  }

  private butterworthBandpassFilter(
    signal: Float32Array,
    lowCut: number,
    highCut: number,
    sampleRate: number,
    order: number = 4
  ): Float32Array {
    // Validación de parámetros
    if (lowCut >= highCut) {
      throw new Error('La frecuencia de corte baja debe ser menor que la frecuencia de corte alta');
    }
    if (sampleRate <= 0) {
      throw new Error('La frecuencia de muestreo debe ser mayor que cero');
    }
    if (order <= 0) {
      throw new Error('El orden del filtro debe ser mayor que cero');
    }

    // Coeficientes del filtro Butterworth
    const nyquist = 0.5 * sampleRate;
    const low = lowCut / nyquist;
    const high = highCut / nyquist;
    
    // Aplicar filtro paso bajo
    let filtered = this.butterworthLowpassFilter(signal, high, order, sampleRate);
    
    // Aplicar filtro paso alto
    filtered = this.butterworthHighpassFilter(filtered, low, order, sampleRate);
    
    return filtered;
  }

  private butterworthLowpassFilter(
    signal: Float32Array,
    cutoff: number,
    order: number,
    sampleRate: number
  ): Float32Array {
    // Implementación del filtro paso bajo Butterworth
    const nfreq = 2 * cutoff / sampleRate;
    const x = Math.tan(Math.PI * nfreq / 2);
    const x2 = x * x;
    
    // Coeficientes del filtro
    const a0 = 1.0 + 1.4142135623730951 * x + x2;
    const a1 = 2.0 * (x2 - 1.0) / a0;
    const a2 = (1.0 - 1.4142135623730951 * x + x2) / a0;
    const b0 = x2 / a0;
    const b1 = 2.0 * b0;
    const b2 = b0;
    
    // Aplicar filtro
    const result = new Float32Array(signal.length);
    let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
    
    for (let i = 0; i < signal.length; i++) {
      const x0 = signal[i];
      const y0 = b0 * x0 + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
      
      result[i] = y0;
      
      // Actualizar estados
      x2 = x1;
      x1 = x0;
      y2 = y1;
      y1 = y0;
    }
    
    return result;
  }

  private butterworthHighpassFilter(
    signal: Float32Array,
    cutoff: number,
    order: number,
    sampleRate: number
  ): Float32Array {
    // Implementación del filtro paso alto Butterworth
    const nfreq = 2 * cutoff / sampleRate;
    const x = Math.tan(Math.PI * nfreq / 2);
    const x2 = x * x;
    
    // Coeficientes del filtro
    const a0 = 1.0 + 1.4142135623730951 * x + x2;
    const a1 = 2.0 * (x2 - 1.0) / a0;
    const a2 = (1.0 - 1.4142135623730951 * x + x2) / a0;
    const b0 = 1.0 / a0;
    const b1 = -2.0 * b0;
    const b2 = b0;
    
    // Aplicar filtro
    const result = new Float32Array(signal.length);
    let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
    
    for (let i = 0; i < signal.length; i++) {
      const x0 = signal[i];
      const y0 = b0 * x0 + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
      
      result[i] = y0;
      
      // Actualizar estados
      x2 = x1;
      x1 = x0;
      y2 = y1;
      y1 = y0;
    }
    
    return result;
  }

  private correctMotionArtifacts(
    signal: Float32Array,
    sampleRate: number
  ): Float32Array {
    // Detección de artefactos por movimiento usando análisis de varianza
    const windowSize = Math.floor(0.1 * sampleRate); // 100ms de ventana
    const result = new Float32Array(signal);
    const threshold = this.calculateNoiseThreshold(signal);
    
    for (let i = windowSize; i < signal.length - windowSize; i++) {
      // Calcular varianza en la ventana actual
      let sum = 0;
      let sumSq = 0;
      
      for (let j = -windowSize; j <= windowSize; j++) {
        const val = signal[i + j];
        sum += val;
        sumSq += val * val;
      }
      
      const mean = sum / (2 * windowSize + 1);
      const variance = (sumSq / (2 * windowSize + 1)) - (mean * mean);
      
      // Si la varianza excede el umbral, suavizar la señal
      if (variance > threshold * 5) { // Umbral 5x el ruido normal
        // Interpolación lineal entre los puntos vecinos
        result[i] = (signal[i-1] + signal[i+1]) / 2;
      }
    }
    
    return result;
  }

  private calculateNoiseThreshold(signal: Float32Array): number {
    // Calcular el umbral de ruido basado en la desviación estándar
    const mean = signal.reduce((a, b) => a + b, 0) / signal.length;
    const variance = signal.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / signal.length;
    return Math.sqrt(variance) * 3; // 3 desviaciones estándar
  }

  private robustNormalize(signal: Float32Array): Float32Array {
    // Normalización robusta usando percentiles
    const sorted = [...signal].sort((a, b) => a - b);
    const p5 = sorted[Math.floor(0.05 * sorted.length)];
    const p95 = sorted[Math.ceil(0.95 * sorted.length)];
    
    const range = p95 - p5 || 1; // Evitar división por cero
    const result = new Float32Array(signal.length);
    
    for (let i = 0; i < signal.length; i++) {
      // Escalar al rango [0, 1] usando los percentiles 5 y 95
      result[i] = Math.max(0, Math.min(1, (signal[i] - p5) / range));
    }
    
    return result;
  }

  private bandpassFilter(
    signal: Float32Array,
    lowCut: number,
    highCut: number,
    sampleRate: number
  ): Float32Array {
    // Implement a proper bandpass filter (Butterworth, Chebyshev, etc.)
    // This is a simplified implementation
    const nyquist = 0.5 * sampleRate;
    const low = lowCut / nyquist;
    const high = highCut / nyquist;
    
    // Simple bandpass using difference of moving averages
    const lowWindow = Math.floor(sampleRate / (2 * highCut));
    const highWindow = Math.floor(sampleRate / (2 * lowCut));
    
    const lowPass = this.movingAverage(signal, lowWindow);
    const highPass = this.movingAverage(signal, highWindow);
    
    // Bandpass = lowpass - highpass
    const result = new Float32Array(signal.length);
    for (let i = 0; i < signal.length; i++) {
      result[i] = lowPass[i] - highPass[i];
    }
    
    return result;
  }

  private movingAverage(
    signal: Float32Array, 
    windowSize: number
  ): Float32Array {
    const result = new Float32Array(signal.length);
    
    for (let i = 0; i < signal.length; i++) {
      let sum = 0;
      let count = 0;
      
      for (let j = Math.max(0, i - windowSize); 
           j <= Math.min(signal.length - 1, i + windowSize); 
           j++) {
        sum += signal[j];
        count++;
      }
      
      result[i] = sum / count;
    }
    
    return result;
  }

  private normalizeSignal(signal: Float32Array): Float32Array {
    // Find min and max values
    let min = Number.MAX_VALUE;
    let max = Number.MIN_VALUE;
    
    for (let i = 0; i < signal.length; i++) {
      if (signal[i] < min) min = signal[i];
      if (signal[i] > max) max = signal[i];
    }
    
    // Avoid division by zero
    const range = max - min || 1;
    
    // Normalize to [-1, 1] for better NN performance
    const normalized = new Float32Array(signal.length);
    for (let i = 0; i < signal.length; i++) {
      normalized[i] = 2 * ((signal[i] - min) / range) - 1;
    }
    
    return normalized;
  }

  private extractFeatures(signal: Float32Array): {
    pulseWaveVelocity?: number;
    augmentationIndex?: number;
    reflectionIndex?: number;
  } {
    // Implement feature extraction from PPG signal
    // This is a simplified implementation
    
    // 1. Find peaks (systolic peaks)
    const peaks: number[] = [];
    for (let i = 1; i < signal.length - 1; i++) {
      if (signal[i] > signal[i - 1] && signal[i] > signal[i + 1]) {
        peaks.push(i);
      }
    }
    
    if (peaks.length < 2) {
      return {}; // Not enough peaks for feature extraction
    }
    
    // 2. Calculate pulse wave velocity (simplified)
    let sumRR = 0;
    for (let i = 1; i < peaks.length; i++) {
      sumRR += (peaks[i] - peaks[i - 1]) / this.samplingRate;
    }
    const avgRR = sumRR / (peaks.length - 1);
    const heartRate = 60 / avgRR;
    
    // Simplified PWV calculation (in reality, this requires distance measurement)
    const pulseWaveVelocity = 4 + (heartRate - 60) * 0.02;
    
    // 3. Calculate augmentation index (simplified)
    let sumAI = 0;
    for (let i = 1; i < Math.min(peaks.length, 10); i++) {
      const peak = peaks[i];
      const prevPeak = peaks[i - 1];
      const nextPeak = i < peaks.length - 1 ? peaks[i + 1] : peak + (peak - prevPeak);
      
      // Find inflection point (simplified)
      const searchStart = peak;
      const searchEnd = Math.min(peak + Math.floor(0.4 * (nextPeak - peak)), signal.length - 1);
      
      let maxSlope = -Infinity;
      let inflectionPoint = peak;
      
      for (let j = searchStart; j < searchEnd; j++) {
        const slope = signal[j + 1] - signal[j];
        if (slope > maxSlope) {
          maxSlope = slope;
          inflectionPoint = j;
        }
      }
      
      const pulseHeight = signal[peak] - signal[prevPeak];
      const inflectionHeight = signal[inflectionPoint] - signal[prevPeak];
      
      if (pulseHeight > 0) {
        sumAI += (inflectionHeight / pulseHeight) * 100;
      }
    }
    
    const augmentationIndex = peaks.length > 1 ? sumAI / Math.min(peaks.length - 1, 9) : 0;
    
    // 4. Calculate reflection index (simplified)
    let sumRI = 0;
    for (let i = 1; i < Math.min(peaks.length, 10); i++) {
      const peak = peaks[i];
      const prevPeak = peaks[i - 1];
      const nextPeak = i < peaks.length - 1 ? peaks[i + 1] : peak + (peak - prevPeak);
      
      // Find reflection point (simplified as fixed percentage of RR interval)
      const reflectionPoint = peak + Math.floor(0.25 * (nextPeak - peak));
      
      if (reflectionPoint < signal.length) {
        const pulseHeight = signal[peak] - signal[prevPeak];
        const reflectionHeight = signal[reflectionPoint] - signal[prevPeak];
        
        if (pulseHeight > 0) {
          sumRI += (reflectionHeight / pulseHeight) * 100;
        }
      }
    }
    
    const reflectionIndex = peaks.length > 1 ? sumRI / Math.min(peaks.length - 1, 9) : 0;
    
    return {
      pulseWaveVelocity,
      augmentationIndex,
      reflectionIndex
    };
  }

  private calculateConfidence(
    signal: Float32Array,
    systolic: number,
    diastolic: number
  ): number {
    // Calculate signal quality metrics
    const signalVariance = this.calculateVariance(signal);
    const signalEntropy = this.calculateShannonEntropy(signal);
    
    // Calculate physiological plausibility
    const ppgAmplitude = Math.max(...signal) - Math.min(...signal);
    const pulsePressure = systolic - diastolic;
    const map = diastolic + (pulsePressure / 3);
    
    // Check physiological ranges
    const validBP = systolic > diastolic && 
                   systolic >= 70 && systolic <= 200 &&
                   diastolic >= 40 && diastolic <= 120;
    
    const validPP = pulsePressure >= 20 && pulsePressure <= 100;
    const validMAP = map >= 60 && map <= 150;
    
    // Calculate confidence score (0-1)
    let confidence = 0.5; // Base confidence
    
    // Adjust based on signal quality
    if (signalVariance > 0.001) confidence += 0.2;
    if (signalEntropy > 0.5) confidence += 0.1;
    
    // Adjust based on physiological plausibility
    if (validBP) confidence += 0.1;
    if (validPP) confidence += 0.05;
    if (validMAP) confidence += 0.05;
    
    // Normalize to [0, 1]
    return Math.max(0, Math.min(1, confidence));
  }

  private calculateVariance(signal: Float32Array): number {
    const mean = signal.reduce((sum, val) => sum + val, 0) / signal.length;
    return signal.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / signal.length;
  }

  private calculateShannonEntropy(signal: Float32Array, bins: number = 10): number {
    // Discretize signal into bins
    const min = Math.min(...signal);
    const max = Math.max(...signal);
    const range = max - min || 1;
    
    const histogram = new Array(bins).fill(0);
    
    for (const value of signal) {
      const bin = Math.min(
        bins - 1, 
        Math.floor(((value - min) / range) * bins)
      );
      histogram[bin]++;
    }
    
    // Calculate probabilities
    const probabilities = histogram.map(count => count / signal.length);
    
    // Calculate entropy
    return -probabilities.reduce((sum, p) => {
      return p > 0 ? sum + p * Math.log2(p) : sum;
    }, 0);
  }

  private clampBPValue(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, value));
  }
}
