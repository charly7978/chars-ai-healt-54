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
    // 1. Remove baseline wander
    const baselineRemoved = this.removeBaselineWander(signal, this.samplingRate);
    
    // 2. Bandpass filter (0.5Hz - 8Hz for PPG)
    const filtered = this.bandpassFilter(
      baselineRemoved, 
      0.5, 
      8, 
      this.samplingRate
    );
    
    // 3. Normalize signal
    return this.normalizeSignal(filtered);
  }

  private removeBaselineWander(
    signal: Float32Array, 
    sampleRate: number
  ): Float32Array {
    // Implement a high-pass filter or other baseline removal technique
    // This is a simplified implementation using a moving average
    const windowSize = Math.floor(sampleRate * 0.5); // 500ms window
    const baseline = new Float32Array(signal.length);
    
    // Calculate moving average as baseline
    for (let i = 0; i < signal.length; i++) {
      let sum = 0;
      let count = 0;
      
      for (let j = Math.max(0, i - windowSize); 
           j <= Math.min(signal.length - 1, i + windowSize); 
           j++) {
        sum += signal[j];
        count++;
      }
      
      baseline[i] = sum / count;
    }
    
    // Subtract baseline from original signal
    const result = new Float32Array(signal.length);
    for (let i = 0; i < signal.length; i++) {
      result[i] = signal[i] - baseline[i];
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
