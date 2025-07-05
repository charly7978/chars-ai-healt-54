import * as tf from '@tensorflow/tfjs';
import { BloodPressureModel, BloodPressureModelConfig, BloodPressurePrediction } from '../../ml/models/BloodPressureModel';

export class BloodPressureProcessor {
  private bpModel: BloodPressureModel;
  private readonly DEFAULT_SIGNAL_LENGTH = 40; // From HeartBeatProcessor.ts
  private readonly DEFAULT_SAMPLING_RATE = 60; // From HeartBeatProcessor.ts

  constructor() {
    const config: BloodPressureModelConfig = {
      signalLength: this.DEFAULT_SIGNAL_LENGTH,
      samplingRate: this.DEFAULT_SAMPLING_RATE,
      inputShape: [this.DEFAULT_SIGNAL_LENGTH, 1], // Expecting one channel PPG
      outputShape: [2], // [systolic, diastolic]
      learningRate: 0.0005 // Default learning rate
    };
    this.bpModel = new BloodPressureModel(config);
    // Load the model if pre-trained. This can be asynchronous.
    // this.bpModel.load(); // Uncomment if there's a pre-trained model to load
  }

  /**
   * Calculates blood pressure using a TensorFlow.js model based on PPG signal
   */
  public async calculateBloodPressure(ppgValues: number[]): Promise<BloodPressurePrediction> {
    if (ppgValues.length < this.DEFAULT_SIGNAL_LENGTH) {
      console.warn('BloodPressureProcessor: Insufficient data for BP calculation. Need at least', this.DEFAULT_SIGNAL_LENGTH, 'samples.');
      return { systolic: 0, diastolic: 0, map: 0, confidence: 0, features: {} };
    }

    // Ensure the input array has the correct length by taking the last N samples
    const inputSignal = new Float32Array(ppgValues.slice(-this.DEFAULT_SIGNAL_LENGTH));

    try {
      const prediction = await this.bpModel.predictBloodPressure(inputSignal);
      return prediction;
    } catch (error) {
      console.error("BloodPressureProcessor: Error predicting BP with model:", error);
      return { systolic: 0, diastolic: 0, map: 0, confidence: 0, features: {} };
    }
  }

  /**
   * Reset the blood pressure processor state
   */
  public reset(): void {
    // No specific state to reset for a stateless model prediction beyond buffer handling if any
    // However, keeping this method for consistency or future stateful processing
  }
}
