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
    // Apply bandpass filter (0.5Hz - 5Hz for PPG)
    const filtered = this.bandpassFilter(signal, 0.5, 5, this.samplingRate);
    
    // Normalize signal to [0, 1]
    return this.normalizeSignal(filtered);
  }

  private bandpassFilter(
    signal: Float32Array,
    lowCut: number,
    highCut: number,
    sampleRate: number
  ): Float32Array {
    // Implement bandpass filter using IIR or FIR
    // This is a simplified implementation - in production, use a proper filter
    const nyquist = 0.5 * sampleRate;
    const low = lowCut / nyquist;
    const high = highCut / nyquist;
    
    // Simple moving average as a placeholder
    const windowSize = Math.floor(sampleRate / (2 * highCut));
    const result = new Float32Array(signal.length);
    
    for (let i = 0; i < signal.length; i++) {
      let sum = 0;
      let count = 0;
      for (let j = Math.max(0, i - windowSize); j <= Math.min(signal.length - 1, i + windowSize); j++) {
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
    
    // Normalize to [0, 1]
    const normalized = new Float32Array(signal.length);
    for (let i = 0; i < signal.length; i++) {
      normalized[i] = (signal[i] - min) / range;
    }
    
    return normalized;
  }
}
