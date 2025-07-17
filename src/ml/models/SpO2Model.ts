import * as tf from '@tensorflow/tfjs';
import { BaseModel, ModelConfig } from './BaseModel';

export interface SpO2ModelConfig extends ModelConfig {
  signalLength: number;
  samplingRate: number;
}

export class SpO2Model extends BaseModel {
  private signalLength: number;
  private samplingRate: number;

  constructor(config: SpO2ModelConfig) {
    super(config, 'SpO2Model');
    this.signalLength = config.signalLength;
    this.samplingRate = config.samplingRate;
  }

  protected buildModel(): tf.LayersModel {
    const model = tf.sequential();
    
    // Input layer - expecting normalized PPG signal [batch, timesteps, features]
    model.add(tf.layers.inputLayer({
      inputShape: [this.signalLength, 2], // [red, ir] channels
      name: 'input_layer'
    }));

    // Initial convolution to extract basic features
    model.add(tf.layers.conv1d({
      filters: 32,
      kernelSize: 5,
      strides: 1,
      padding: 'same',
      activation: 'relu',
      name: 'conv1d_1'
    }));
    model.add(tf.layers.maxPooling1d({
      poolSize: 2,
      strides: 2,
      name: 'max_pool_1'
    }));

    // Deeper convolution layers
    model.add(tf.layers.conv1d({
      filters: 64,
      kernelSize: 3,
      strides: 1,
      padding: 'same',
      activation: 'relu',
      name: 'conv1d_2'
    }));
    model.add(tf.layers.maxPooling1d({
      poolSize: 2,
      strides: 2,
      name: 'max_pool_2'
    }));

    // LSTM layers to capture temporal dependencies
    model.add(tf.layers.bidirectional({
      layer: tf.layers.lstm({
        units: 64,
        returnSequences: true,
        name: 'lstm_1'
      })
    }));
    
    model.add(tf.layers.dropout({ rate: 0.3, name: 'dropout_1' }));
    
    model.add(tf.layers.bidirectional({
      layer: tf.layers.lstm({
        units: 32,
        name: 'lstm_2'
      })
    }));

    // Dense layers for final prediction
    model.add(tf.layers.dense({
      units: 32,
      activation: 'relu',
      name: 'dense_1'
    }));
    
    model.add(tf.layers.dropout({ rate: 0.2, name: 'dropout_2' }));
    
    // Output layer - predicts SpO2 value (0-100%)
    model.add(tf.layers.dense({
      units: 1,
      activation: 'sigmoid',
      name: 'output_layer'
    }));

    // Compile the model
    model.compile({
      optimizer: tf.train.adam(this.config.learningRate),
      loss: 'meanSquaredError',
      metrics: ['mae']
    });

    return model;
  }

  public async predictSpO2(
    redSignal: Float32Array,
    irSignal: Float32Array,
    preprocess: boolean = true
  ): Promise<{ spo2: number; confidence: number }> {
    if (redSignal.length !== irSignal.length) {
      throw new Error('Red and IR signals must have the same length');
    }

    // Preprocess signals if needed
    let processedRed = redSignal;
    let processedIr = irSignal;
    
    if (preprocess) {
      processedRed = this.preprocessSignal(redSignal);
      processedIr = this.preprocessSignal(irSignal);
    }

    // Create input tensor [1, signalLength, 2]
    const inputData = new Float32Array(redSignal.length * 2);
    for (let i = 0; i < redSignal.length; i++) {
      inputData[i * 2] = processedRed[i];
      inputData[i * 2 + 1] = processedIr[i];
    }

    const inputTensor = tf.tensor3d(
      inputData,
      [1, redSignal.length, 2]
    );

    // Make prediction
    const prediction = await this.model.predict(inputTensor);
    const predictionData = await prediction.data();
    const spo2Value = predictionData[0] * 100; // Convert to percentage
    
    // Calculate confidence based on prediction variance
    const confidence = 1.0 - (Math.abs(spo2Value - 97) / 30); // Simple confidence heuristic
    
    tf.dispose([inputTensor, prediction]);
    
    return {
      spo2: Math.max(70, Math.min(100, spo2Value)), // Clamp to physiological range
      confidence: Math.max(0, Math.min(1, confidence)) // Clamp to [0, 1]
    };
  }

  private preprocessSignal(signal: Float32Array): Float32Array {
    // 1. Validar señal de entrada
    if (!signal || signal.length === 0) {
      throw new Error('Señal de entrada no válida');
    }

    // 2. Eliminar línea de base
    const baselineRemoved = this.removeBaselineWander(signal, this.samplingRate);
    
    // 3. Aplicar filtro paso banda de 0.5Hz a 5Hz
    const filtered = this.butterworthBandpassFilter(
      baselineRemoved,
      0.5,  // Frecuencia de corte baja (Hz)
      5.0,  // Frecuencia de corte alta (Hz)
      this.samplingRate,
      4     // Orden del filtro
    );
    
    // 4. Corregir artefactos de movimiento
    const artifactCorrected = this.correctMotionArtifacts(filtered, this.samplingRate);
    
    // 5. Normalización robusta usando percentiles
    return this.robustNormalize(artifactCorrected);
  }

  private removeBaselineWander(
    signal: Float32Array,
    sampleRate: number
  ): Float32Array {
    // Filtro de paso alto para eliminar la deriva de la línea de base
    const cutoffFreq = 0.5; // Hz
    const rc = 1.0 / (2 * Math.PI * cutoffFreq);
    const dt = 1.0 / sampleRate;
    const alpha = dt / (rc + dt);
    
    const result = new Float32Array(signal.length);
    let highpass = signal[0];
    
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

    // Aplicar filtro paso bajo
    let filtered = this.butterworthLowpassFilter(signal, highCut, order, sampleRate);
    
    // Aplicar filtro paso alto
    filtered = this.butterworthHighpassFilter(filtered, lowCut, order, sampleRate);
    
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
      normalized[i] = (signal[i] - min) / range;
    }
    
    return normalized;
  }
}
