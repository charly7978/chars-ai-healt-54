import * as tf from '@tensorflow/tfjs';
import { securityService } from '../../security/SecurityService';
import { dataAnonymizer } from '../../security/DataAnonymizer';

interface TransferLearningConfig {
  baseModel: tf.LayersModel;
  trainableLayers: number; // Number of layers to fine-tune from the end
  learningRate: number;
  batchSize: number;
  epochs: number;
  validationSplit: number;
  minSamples: number; // Minimum samples required for personalization
  privacyNoiseScale?: number; // For differential privacy
}

type PersonalizationData = {
  x: tf.Tensor;
  y: tf.Tensor;
};

export class TransferLearningService {
  private config: TransferLearningConfig;
  private model: tf.LayersModel;
  private personalizationData: PersonalizationData[] = [];
  private isTraining = false;
  private personalizationId: string;
  
  constructor(config: TransferLearningConfig) {
    this.config = {
      learningRate: 0.001,
      batchSize: 32,
      epochs: 5,
      validationSplit: 0.2,
      minSamples: 50,
      privacyNoiseScale: 0.1,
      ...config
    };
    
    // Create a personalized copy of the base model
    this.model = this.cloneAndPrepareModel(config.baseModel);
    
    // Generate a unique ID for this personalization session
    this.personalizationId = `personalization_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
  
  private cloneAndPrepareModel(baseModel: tf.LayersModel): tf.LayersModel {
    // Clone the base model
    const model = tf.sequential();
    
    // Add all layers except the last few that we'll fine-tune
    const numLayers = baseModel.layers.length;
    const numFrozenLayers = numLayers - this.config.trainableLayers;
    
    for (let i = 0; i < numLayers; i++) {
      const layer = baseModel.layers[i];
      const layerConfig = layer.getConfig();
      
      // Create a new layer with the same configuration
      const newLayer = tf.layers[layer.getClassName().replace('_', '')](layerConfig);
      
      // Set trainable status
      newLayer.trainable = i >= numFrozenLayers;
      
      // Add to the model
      model.add(newLayer);
      
      // Copy weights
      if (i < baseModel.weights.length) {
        const weights = layer.getWeights();
        if (weights.length > 0) {
          newLayer.setWeights(weights);
        }
      }
    }
    
    // Compile the model
    model.compile({
      optimizer: tf.train.adam(this.config.learningRate),
      loss: 'meanSquaredError',
      metrics: ['mae']
    });
    
    return model;
  }
  
  public addPersonalizationData(x: tf.Tensor, y: tf.Tensor): void {
    if (x.shape[0] !== y.shape[0]) {
      throw new Error('Number of samples in x and y must match');
    }
    
    // Add noise for differential privacy if enabled
    if (this.config.privacyNoiseScale && this.config.privacyNoiseScale > 0) {
      x = this.addNoise(x, this.config.privacyNoiseScale);
      y = this.addNoise(y, this.config.privacyNoiseScale);
    }
    
    this.personalizationData.push({ x, y });
  }
  
  private addNoise(tensor: tf.Tensor, scale: number): tf.Tensor {
    const noise = tf.randomNormal(tensor.shape, 0, scale);
    const result = tensor.add(noise);
    noise.dispose();
    return result;
  }
  
  public async personalize(): Promise<tf.History | null> {
    if (this.isTraining) {
      throw new Error('Personalization already in progress');
    }
    
    // Check if we have enough data
    const totalSamples = this.getTotalSamples();
    if (totalSamples < this.config.minSamples) {
      console.warn(`Not enough samples for personalization (${totalSamples}/${this.config.minSamples})`);
      return null;
    }
    
    this.isTraining = true;
    
    try {
      // Combine all personalization data
      const { x, y } = this.combinePersonalizationData();
      
      // Train the model
      const history = await this.model.fit(x, y, {
        batchSize: this.config.batchSize,
        epochs: this.config.epochs,
        validationSplit: this.config.validationSplit,
        callbacks: {
          onEpochEnd: async (epoch, logs) => {
            console.log(`Personalization epoch ${epoch + 1}: loss = ${logs?.loss?.toFixed(4)}`);
            await tf.nextFrame();
          }
        }
      });
      
      // Save the personalized model
      await this.savePersonalizedModel();
      
      return history;
      
    } finally {
      this.isTraining = false;
    }
  }
  
  private getTotalSamples(): number {
    return this.personalizationData.reduce(
      (sum, data) => sum + data.x.shape[0], 0
    );
  }
  
  private combinePersonalizationData(): { x: tf.Tensor, y: tf.Tensor } {
    if (this.personalizationData.length === 0) {
      throw new Error('No personalization data available');
    }
    
    // If there's only one batch, return it directly
    if (this.personalizationData.length === 1) {
      return this.personalizationData[0];
    }
    
    // Concatenate all batches
    const xs = this.personalizationData.map(d => d.x);
    const ys = this.personalizationData.map(d => d.y);
    
    const x = tf.concat(xs, 0);
    const y = tf.concat(ys, 0);
    
    // Clean up the original tensors
    xs.forEach(t => t.dispose());
    ys.forEach(t => t.dispose());
    
    return { x, y };
  }
  
  private async savePersonalizedModel(): Promise<void> {
    const modelInfo = {
      modelTopology: this.model.toJSON(),
      weightData: await this.model.save(tf.io.withSaveHandler(async (artifacts) => {
        // Encrypt the model weights for secure storage
        const weightData = Array.from(new Uint8Array(await artifacts.weightData.arrayBuffer()));
        return securityService.encryptData({
          weightData,
          weightSpecs: artifacts.weightSpecs,
          modelTopology: artifacts.modelTopology,
          format: artifacts.format,
          generatedBy: artifacts.generatedBy,
          convertedBy: artifacts.convertedBy
        });
      })),
      metadata: {
        personalizationId: this.personalizationId,
        timestamp: new Date().toISOString(),
        numSamples: this.getTotalSamples(),
        trainableParams: this.model.trainableWeights.length
      }
    };
    
    // Save to IndexedDB
    await this.saveToIndexedDB(modelInfo);
  }
  
  private async saveToIndexedDB(modelInfo: any): Promise<void> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open('PersonalizedModels', 1);
      
      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        if (!db.objectStoreNames.contains('models')) {
          db.createObjectStore('models', { keyPath: 'personalizationId' });
        }
      };
      
      request.onsuccess = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        const transaction = db.transaction(['models'], 'readwrite');
        const store = transaction.objectStore('models');
        
        store.put({
          personalizationId: this.personalizationId,
          data: modelInfo,
          timestamp: Date.now()
        });
        
        transaction.oncomplete = () => resolve();
        transaction.onerror = (e) => reject(e);
      };
      
      request.onerror = (event) => {
        reject(new Error('Failed to open IndexedDB'));
      };
    });
  }
  
  public async loadPersonalizedModel(personalizationId: string): Promise<boolean> {
    try {
      const modelInfo = await this.loadFromIndexedDB(personalizationId);
      
      if (!modelInfo) {
        return false;
      }
      
      // Decrypt the model weights
      const decryptedData = securityService.decryptData(modelInfo.data) as {
        modelTopology: any;
        weightSpecs: any[];
        weightData: ArrayBuffer | Float32Array | Int32Array | Uint8Array;
      };
      
      // Reconstruct the model
      const model = await tf.loadLayersModel(tf.io.fromMemory({
        modelTopology: decryptedData.modelTopology,
        weightSpecs: decryptedData.weightSpecs,
        weightData: decryptedData.weightData instanceof ArrayBuffer 
          ? decryptedData.weightData 
          : new Float32Array(decryptedData.weightData).buffer
      }));
      
      // Replace the current model
      this.model.dispose();
      this.model = model;
      this.personalizationId = personalizationId;
      
      return true;
      
    } catch (error) {
      console.error('Failed to load personalized model:', error);
      return false;
    }
  }
  
  private async loadFromIndexedDB(personalizationId: string): Promise<any> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open('PersonalizedModels', 1);
      
      request.onsuccess = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        const transaction = db.transaction(['models'], 'readonly');
        const store = transaction.objectStore('models');
        const getRequest = store.get(personalizationId);
        
        getRequest.onsuccess = () => resolve(getRequest.result);
        getRequest.onerror = () => resolve(null);
      };
      
      request.onerror = () => resolve(null);
    });
  }
  
  public async predict(x: tf.Tensor): Promise<tf.Tensor> {
    return this.model.predict(x) as tf.Tensor;
  }
  
  public async anonymizeAndExportModel(): Promise<ArrayBuffer> {
    // Get the model weights
    const weights = this.model.getWeights();
    
    // Anonymize the weights (add noise)
    const anonymizedWeights = weights.map(weight => {
      const noisyWeight = this.addNoise(weight, this.config.privacyNoiseScale || 0.1);
      return noisyWeight;
    });
    
    // Set the anonymized weights
    this.model.setWeights(anonymizedWeights);
    
    // Export the model
    const modelArtifacts = await this.model.save(tf.io.withSaveHandler(async (artifacts) => {
      return {
        ...artifacts,
        // Add metadata indicating this is an anonymized model
        userMetadata: {
          ...artifacts.userMetadata,
          isAnonymized: true,
          anonymizationTimestamp: new Date().toISOString(),
          noiseScale: this.config.privacyNoiseScale
        }
      };
    }));
    
    // Convert to ArrayBuffer for export
    const weightData = await (modelArtifacts.weightData as unknown as Blob).arrayBuffer();
    
    // Create a combined buffer with metadata and weights
    const metadata = {
      modelTopology: modelArtifacts.modelTopology,
      weightSpecs: modelArtifacts.weightSpecs,
      format: modelArtifacts.format,
      generatedBy: modelArtifacts.generatedBy,
      convertedBy: modelArtifacts.convertedBy,
      userMetadata: modelArtifacts.userMetadata
    };
    
    const metadataStr = JSON.stringify(metadata);
    const metadataBuffer = new TextEncoder().encode(metadataStr);
    
    const combinedBuffer = new ArrayBuffer(4 + metadataBuffer.byteLength + weightData.byteLength);
    const view = new DataView(combinedBuffer);
    
    // Store metadata length (4 bytes)
    view.setUint32(0, metadataBuffer.byteLength, true);
    
    // Copy metadata
    const metadataArray = new Uint8Array(combinedBuffer, 4, metadataBuffer.byteLength);
    metadataArray.set(new Uint8Array(metadataBuffer));
    
    // Copy weights
    const weightsArray = new Uint8Array(combinedBuffer, 4 + metadataBuffer.byteLength, weightData.byteLength);
    weightsArray.set(new Uint8Array(weightData));
    
    return combinedBuffer;
  }
  
  public dispose(): void {
    // Clean up resources
    this.model.dispose();
    this.personalizationData.forEach(data => {
      data.x.dispose();
      data.y.dispose();
    });
    this.personalizationData = [];
  }
}

// Helper function to create a transfer learning service
export async function createTransferLearningService(
  baseModel: tf.LayersModel,
  config: Partial<TransferLearningConfig> = {}
): Promise<TransferLearningService> {
  const defaultConfig: Partial<TransferLearningConfig> = {
    trainableLayers: 2, // Fine-tune the last 2 layers by default
    learningRate: 0.001,
    batchSize: 32,
    epochs: 5,
    validationSplit: 0.2,
    minSamples: 50,
    privacyNoiseScale: 0.1
  };
  
  const service = new TransferLearningService({
    baseModel,
    ...defaultConfig,
    ...config
  });
  
  return service;
}
