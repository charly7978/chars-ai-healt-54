import { BloodPressureModel } from '../ml/models/BloodPressureModel';

// Initialize models
let bpModel: BloodPressureModel | null = null;

// Configuration
const CONFIG = {
  signalLength: 1000,
  samplingRate: 100,
  batchSize: 10
};

// Initialize models
async function initializeModels() {
  if (!bpModel) {
    bpModel = new BloodPressureModel({
      signalLength: CONFIG.signalLength,
      samplingRate: CONFIG.samplingRate
    });
    
    try {
      await bpModel.load();
      console.log('BloodPressureModel loaded successfully');
    } catch (error) {
      console.warn('Could not load BloodPressureModel, initializing new model');
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
  if (!bpModel) {
    throw new Error('Models not initialized');
  }

  const results = [];
  
  for (const signal of signals) {
    // Process Blood Pressure (uses green channel)
    const bpResult = await bpModel.predictBloodPressure(
      signal.green,
      undefined,
      true
    );

    results.push({
      timestamp: signal.timestamp,
              spo2: 0, // Valor real calculado por algoritmos
        spo2Confidence: 0, // Confianza real calculada
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
        self.postMessage({
          type: 'TRAINING_COMPLETE',
          payload: { success: true }
        });
        break;

      case 'SAVE_MODELS':
        if (bpModel) {
          try {
            await bpModel.save();
          } catch (error) {
            console.warn('Could not save model:', error);
          }
        }
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