import * as tf from '@tensorflow/tfjs';

export interface BloodPressureModelConfig {
  signalLength: number;
  samplingRate: number;
  learningRate?: number;
  batchSize?: number;
  epochs?: number;
}

export class BloodPressureModel {
  private model: tf.LayersModel | null = null;
  private config: BloodPressureModelConfig;

  constructor(config: BloodPressureModelConfig) {
    this.config = config;
    this.initializeModel();
  }

  private initializeModel(): void {
    this.model = tf.sequential({
      layers: [
        tf.layers.dense({ inputShape: [this.config.signalLength], units: 64, activation: 'relu' }),
        tf.layers.dropout({ rate: 0.2 }),
        tf.layers.dense({ units: 32, activation: 'relu' }),
        tf.layers.dense({ units: 2, activation: 'linear' })
      ]
    });

    this.model.compile({
      optimizer: tf.train.adam(this.config.learningRate || 0.001),
      loss: 'meanSquaredError',
      metrics: ['mae']
    });
  }

  public async predictBloodPressure(
    ppgSignal: Float32Array,
    ecgSignal?: Float32Array,
    preprocess: boolean = true
  ): Promise<{
    systolic: number;
    diastolic: number;
    map: number;
    confidence: number;
    features: any;
  }> {
    if (!this.model) {
      throw new Error('Model not initialized');
    }

    let processedSignal = ppgSignal;
    if (preprocess) {
      processedSignal = this.preprocessSignal(ppgSignal);
    }

    const inputTensor = tf.tensor2d([Array.from(processedSignal)]);
    const prediction = this.model.predict(inputTensor) as tf.Tensor;
    const values = await prediction.data();
    
    const systolic = Math.max(80, Math.min(200, values[0] * 50 + 120));
    const diastolic = Math.max(50, Math.min(120, values[1] * 30 + 80));
    const map = (systolic + 2 * diastolic) / 3;
    const confidence = Math.min(1.0, 1.0 - Math.abs(systolic - 120) / 100);

    inputTensor.dispose();
    prediction.dispose();

    return {
      systolic: Math.round(systolic),
      diastolic: Math.round(diastolic),
      map: Math.round(map),
      confidence,
      features: { pulseWaveVelocity: 0, augmentationIndex: 0, reflectionIndex: 0 }
    };
  }

  private preprocessSignal(signal: Float32Array): Float32Array {
    const mean = signal.reduce((sum, val) => sum + val, 0) / signal.length;
    const std = Math.sqrt(signal.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / signal.length);
    return new Float32Array(signal.map(val => (val - mean) / (std || 1)));
  }

  public async save(): Promise<void> {
    if (!this.model) return;
    try {
      await this.model.save('localstorage://blood-pressure-model');
    } catch (error) {
      console.warn('Could not save BloodPressureModel:', error);
    }
  }

  public async load(): Promise<void> {
    try {
      this.model = await tf.loadLayersModel('localstorage://blood-pressure-model');
    } catch (error) {
      console.warn('Could not load BloodPressureModel:', error);
      this.initializeModel();
    }
  }

  public dispose(): void {
    if (this.model) {
      this.model.dispose();
      this.model = null;
    }
  }
}