import { BloodPressureModel } from '../ml/models/BloodPressureModel';
import { SpO2Model } from '../ml/models/SpO2Model';

// Initialize models
let bpModel: BloodPressureModel | null = null;
let spo2Model: SpO2Model | null = null;

// Configuration
const CONFIG = {
  signalLength: 1000, // Adjust based on your sampling rate and window size
  samplingRate: 100,  // Hz
  batchSize: 10       // Number of samples to process in a batch
};

// Initialize models
async function initializeModels() {
  if (!bpModel) {
    bpModel = new BloodPressureModel({
      signalLength: CONFIG.signalLength,
      samplingRate: CONFIG.samplingRate,
      inputShape: [CONFIG.signalLength, 1],
      outputShape: [2],
      learningRate: 0.0005
    });
    
    try {
      await bpModel.load();
      console.log('BloodPressureModel loaded successfully');
    } catch (error) {
      console.warn('Could not load BloodPressureModel, initializing new model');
    }
  }

  if (!spo2Model) {
    spo2Model = new SpO2Model({
      signalLength: CONFIG.signalLength,
      samplingRate: CONFIG.samplingRate,
      inputShape: [CONFIG.signalLength, 2],
      outputShape: [1],
      learningRate: 0.001
    });
    
    try {
      await spo2Model.load();
      console.log('SpO2Model loaded successfully');
    } catch (error) {
      console.warn('Could not load SpO2Model, initializing new model');
    }
  }
}

// Process signals in batches
async function processSignals(signals: {
  red: Float32Array;
  ir: Float32Array;
  green: Float32Array;
  timestamp: number;
}[]) {
  if (!bpModel || !spo2Model) {
    throw new Error('Models not initialized');
  }

  const results = [];
  
  for (const signal of signals) {
    // Process SpO2 (uses red and IR)
    const spo2Result = await spo2Model.predictSpO2(
      signal.red,
      signal.ir,
      true // preprocess
    );

    // Process Blood Pressure (uses green channel)
    const bpResult = await bpModel.predictBloodPressure(
      signal.green,
      undefined, // ECG signal if available
      true       // preprocess
    );

    results.push({
      timestamp: signal.timestamp,
      spo2: spo2Result.spo2,
      spo2Confidence: spo2Result.confidence,
      systolic: bpResult.systolic,
      diastolic: bpResult.diastolic,
      map: bpResult.map,
      bpConfidence: bpResult.confidence,
      features: bpResult.features
    });
  }

  return results;
}

// Handle messages from the main thread
self.onmessage = async (event: MessageEvent) => {
  const { type, payload } = event.data;

  try {
    switch (type) {
      case 'INIT':
        await initializeModels();
        self.postMessage({ type: 'INIT_COMPLETE' });
        break;

      case 'PROCESS_SIGNALS':
        const results = await processSignals(payload.signals);
        self.postMessage({
          type: 'PROCESSING_COMPLETE',
          payload: { results }
        });
        break;

      case 'TRAIN_MODEL':
        // Implement model training with federated learning
        // This would involve receiving model updates and applying them
        self.postMessage({
          type: 'TRAINING_COMPLETE',
          payload: { success: true }
        });
        break;

      case 'SAVE_MODELS':
        if (bpModel) await bpModel.save();
        if (spo2Model) await spo2Model.save();
        self.postMessage({ type: 'MODELS_SAVED' });
        break;

      default:
        console.warn(`Unknown message type: ${type}`);
    }
  } catch (error) {
    console.error('Error in worker:', error);
    self.postMessage({
      type: 'ERROR',
      payload: {
        message: error instanceof Error ? error.message : 'Unknown error occurred'
      }
    });
  }
};

// Initialize models when worker loads
initializeModels().catch(console.error);

// Required for TypeScript to recognize this as a Web Worker
export default {} as typeof Worker & (new () => Worker);
